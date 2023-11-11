const AMOUNT = 10000; // Amount of particles (50k was the highest we could go without lag. Limit depends on your hardware)

const canvas = document.querySelector("canvas");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;


if (!navigator.gpu) {
    throw new Error("WebGPU not supported on this browser.");
}

// Init webgpu for canvas
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

// Basic rectangle vertices
const vertices = new Float32Array([
    //   X,    Y,
    0, 0,
    0.005, 0,
    0.005, 0.005,

    0, 0,
    0.005, 0.005,
    0, 0.005,
]); 


// Create a vertex buffer
const buf = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(buf, /*bufferOffset=*/0, vertices);


const particleArray = new Float32Array(AMOUNT*(2+2+3));
// Storage needs 2 arrays, 1 to be read, 1 to be written to
const particleStorage = [
  device.createBuffer({
    label: "Particle array #1",
    size: particleArray.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  }),
  device.createBuffer({
    label: "Particle array #2",
    size: particleArray.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
];
  


// Fill particleArray with data to create a fun snowfall effect
for (let i = 0; i < particleArray.length; i+=7) {

    particleArray[i] = Math.random()*2-1;   // X
    particleArray[i+1] = ((Math.random()*2+1)); // Y

    particleArray[i+2] = (Math.random()*0.5)*0.0001;   // Force to X
    particleArray[i+3] = -0.00005*(Math.random()+1); // Force to Y

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


// Layout for bind groups 1st item is read only, 2nd is writable
const bindGroupLayout = device.createBindGroupLayout({
  label: "Particle Bind Group Layout",
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
    buffer: { type: "read-only-storage"} // Read-only particle data
  }, {
    binding: 1,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { type: "storage"} // Read-write buffer
  }]
});


// Define layout for pipeline
const pipelineLayout = device.createPipelineLayout({
  label: "Particle Pipeline Layout",
  bindGroupLayouts: [ bindGroupLayout ],
});


// Pipeline for render pass
// Buffer is being rendered here
const particleShaderModule = device.createShaderModule({
    label: "Particle shader",
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
const particlePipeline = device.createRenderPipeline({
    label: "Particle pipeline",
    layout: pipelineLayout,
    vertex: {
        module: particleShaderModule,
        entryPoint: "vertexMain",
        buffers: [vertexBufferLayout]
    },
    fragment: {
        module: particleShaderModule,
        entryPoint: "fragmentMain",
        targets: [{
            format: canvasFormat
        }]
    }
});






// Pipeline for compute pass
// Buffer data is modified here
const simulationShaderModule = device.createShaderModule({
  label: "Snowfall simulation shader",
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
        


        if(out[index*7] > 1 || out[index*7]<-1){
          out[index*7] = -1;
        }

        if(out[index*7+1] < -1){
          out[index*7+1] = 1;
        }


      }
      
    }
  `
});

// Simulation pipeline object
const simulationPipeline = device.createComputePipeline({
  label: "Simulation pipeline",
  layout: pipelineLayout,
  compute: {
    module: simulationShaderModule,
    entryPoint: "computeMain",
  }
});





// 2 bind groups which are switched every frame. At the compute pass particle storage is edited and during render pass the data is rendered
const bindGroups = [
  device.createBindGroup({
    label: "Particle storate bind group #1",
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
    label: "Particle storate bind group #2",
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


  


  

var step = 0; // Step is used to switch between the bind groups

// Rendering function, is called upon 60 times a second
function draw(){
    const encoder = device.createCommandEncoder();


    // Compute pass, particle data is edited here.
    const computePass = encoder.beginComputePass();

    computePass.setPipeline(simulationPipeline);
    computePass.setBindGroup(0, bindGroups[step % 2]);
    const workgroupCount = Math.ceil(1000/64); // Can be changed but chrome doesnt like it if its too high
    computePass.dispatchWorkgroups(workgroupCount);
    computePass.end();

    step++;

    // Render pass
    const pass = encoder.beginRenderPass({
    colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        clearValue: { r: 0, g: 0, b: 0, a: 1 }, // Set background color of scene
        storeOp: "store",
        }],
    });

    
    // Draw
    pass.setPipeline(particlePipeline);    

    pass.setVertexBuffer(0, buf);

    pass.setBindGroup(0, bindGroups[step % 2]);

    pass.draw(vertices.length/2,AMOUNT); 

    // End the render pass and submit the command buffer
    pass.end();
    device.queue.submit([encoder.finish()]);

}


setInterval(draw, 1000/60); // Call 60 times a sec