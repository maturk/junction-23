const AMOUNT = 10000;

const canvas = document.querySelector("canvas");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;


if (!navigator.gpu) {
    throw new Error("WebGPU not supported on this browser.");
}

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
const context = canvas.getContext("webgpu");
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
context.configure({
    device: device,
    format: canvasFormat,
});

// GPUCommandEncoder provides an interface for recording GPU commands.
const encoder = device.createCommandEncoder();


const vertices = new Float32Array([
    //   X,    Y,
    0, 0,
    0.005, 0,
    0.005, 0.005,

    0, 0,
    0.005, 0.005,
    0, 0.005,
]); 

const buf = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(buf, /*bufferOffset=*/0, vertices);


const particleArray = new Float32Array(AMOUNT*(2+2+3));
const particleStorage = [
  device.createBuffer({
    label: "Cell State A",
    size: particleArray.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  }),
  device.createBuffer({
    label: "Cell State B",
    size: particleArray.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
];
  


var angleInc = Math.PI*2/AMOUNT;

for (let i = 0; i < particleArray.length; i+=7) {

    particleArray[i] = i/AMOUNT *2 -1;   // X
    particleArray[i+1] = 0; // Y
    // particleArray[i] = Math.cos(angleInc*i)*(window.innerHeight/window.innerWidth)*0.5;   // X
    // particleArray[i+1] = Math.sin(angleInc*i)*0.5; // Y

    // particleArray[i+2] = 0;   // Force to X
    // particleArray[i+3] = 0; // Force to Y
    particleArray[i+2] = 0.0003;   // Force to X
    particleArray[i+3] = 0; // Force to Y

    particleArray[i+4] = 1;   // R
    particleArray[i+5] = 1;   // G
    particleArray[i+6] = 1; // B



  }
  device.queue.writeBuffer(particleStorage[0], 0, particleArray);
  device.queue.writeBuffer(particleStorage[1], 0, particleArray);





// define how the vertex data is stored in memory so the gpu knows how to access it
const vertexBufferLayout = {
    arrayStride: 8,
    attributes: [{
        format: "float32x2",
        offset: 0,
        shaderLocation: 0, // Position, see vertex shader
    }],
};

const bindGroupLayout = device.createBindGroupLayout({
  label: "Cell Bind Group Layout",
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
    buffer: { type: "read-only-storage"} // Cell state input buffer
  }, {
    binding: 1,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { type: "storage"} // Cell state output buffer
  }]
});

const pipelineLayout = device.createPipelineLayout({
  label: "Cell Pipeline Layout",
  bindGroupLayouts: [ bindGroupLayout ],
});


// our first webgpu shader
const cellShaderModule = device.createShaderModule({
    label: "Cell shader",
    code: `
        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) color: vec4f,
        };
      

        @group(0) @binding(0) var<storage> data: array<f32>;
        

        @vertex
        fn vertexMain(@location(0) pos: vec2f,
                    @builtin(instance_index) instance: u32) -> VertexOutput {
        
        let x = f32(data[instance*7]);
        let y = f32(data[instance*7+1]);

        var output : VertexOutput;
        output.pos = vec4f(pos.x+x,pos.y+y, 0, 1);
        output.color = vec4f(data[instance*7+4],data[instance*7+5],data[instance*7+6],1);

        return output;
        }
    

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
        return input.color;
        }
    `
});




// pipeline object
const cellPipeline = device.createRenderPipeline({
    label: "Cell pipeline",
    layout: pipelineLayout,
    vertex: {
        module: cellShaderModule,
        entryPoint: "vertexMain",
        buffers: [vertexBufferLayout]
    },
    fragment: {
        module: cellShaderModule,
        entryPoint: "fragmentMain",
        targets: [{
            format: canvasFormat
        }]
    }
});







const simulationShaderModule = device.createShaderModule({
  label: "Life simulation shader",
  code: `

    @group(0) @binding(0) var<storage> data: array<f32>;
    @group(0) @binding(1) var<storage, read_write> out: array<f32>;


    @compute @workgroup_size(64)
    fn computeMain(@builtin(global_invocation_id) cell: vec3u) {

      for(var index: u32 = 0; index < ${AMOUNT}; index++){

        out[index*7] += out[index*7+2]; // add force to x
        out[index*7+1] += out[index*7+3]; // add force to y

        //out[index*7+2] += cos(6.28*f32(index)*out[index*7+2]);
        //out[index*7+3] = -0.00008;
        //out[index*7+2] = 0.0001;
        //out[index*7+3] = 0;

        


        if(out[index*7] > 1 || out[index*7]<-1){
          out[index*7+2] *= -1;
          out[index*7+1] += 0.01;
          out[index*7] = 0;
        }

        if(out[index*7+1] < -1){
          out[index*7+1] = 1;
        }


      }
      
    }
  `
});

const simulationPipeline = device.createComputePipeline({
  label: "Simulation pipeline",
  layout: pipelineLayout,
  compute: {
    module: simulationShaderModule,
    entryPoint: "computeMain",
  }
});





// Bind storage to shader
// const bindGroup = device.createBindGroup({
//     layout: cellPipeline.getBindGroupLayout(0),
//     entries: [
//     {
//       binding: 0,
//       resource: { buffer: particleStorage[0] }
//     }],
//   });


const bindGroups = [
  device.createBindGroup({
    label: "Cell renderer bind group A",
    layout: bindGroupLayout,
    entries: [ {
      binding: 0,
      resource: { buffer: particleStorage[0] }
    }, {
      binding: 1,
      resource: { buffer: particleStorage[1] }
    }],
  }),
  device.createBindGroup({
    label: "Cell renderer bind group B",
    layout: bindGroupLayout,
    entries: [{
      binding: 0,
      resource: { buffer: particleStorage[1] }
    }, {
      binding: 1,
      resource: { buffer: particleStorage[0] }
    }],
  }),
];


  


  

var step = 0;
function draw(){
    // Start a render pass 
    const encoder = device.createCommandEncoder();


    const computePass = encoder.beginComputePass();

    computePass.setPipeline(simulationPipeline);
    computePass.setBindGroup(0, bindGroups[step % 2]);
    const workgroupCount = Math.ceil(1000/64); // Can be changed but chrome doesnt like it if its too high
    computePass.dispatchWorkgroups(workgroupCount);
    computePass.end();

    step++;

    const pass = encoder.beginRenderPass({
    colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        clearValue: { r: 0, g: 0, b: 0, a: 1 }, // New line
        storeOp: "store",
        }],
    });

    
    // Draw
    pass.setPipeline(cellPipeline);    

    pass.setVertexBuffer(0, buf);

    pass.setBindGroup(0, bindGroups[step % 2]);

    pass.draw(vertices.length/2,AMOUNT); 

    // End the render pass and submit the command buffer
    pass.end();
    device.queue.submit([encoder.finish()]);

}


setInterval(draw, 1000/60);



// canvas.addEventListener("click",(ev) => {

//   let x = ev.offsetX/window.innerWidth*2 -1;
//   let y = ev.offsetY/window.innerHeight*2 -1;
  
//   for (let i = 0; i < particleArray.length; i+=7) {

//     // particleArray[i+2] = (Math.random()*2-1)*0.001;   // Force to X
//     // particleArray[i+3] = (Math.random()*2-1)*0.001; // Force to Y
//     var dx = x - particleArray[i];
//     var dy = y - particleArray[i+1]; 

//     particleArray[i+2] -= (dx)*0.001;   // Force to X
//     particleArray[i+3] -= (dy)*0.001; // Force to Y



//   }
//   device.queue.writeBuffer(particleStorage[0], 0, particleArray);
//   device.queue.writeBuffer(particleStorage[1], 0, particleArray);


// });