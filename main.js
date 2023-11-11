import {Point} from "./point.js"

const AMOUNT = 10000


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
    0.01, 0,
    0.01, 0.01,

    0, 0,
    0.01, 0.01,
    0, 0.01,
]); 

const buf = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(buf, /*bufferOffset=*/0, vertices);


const posOffsetArray = new Float32Array(AMOUNT*(2+2+3));
const posOffsetStorage = device.createBuffer({
    label: "Cell State",
    size: posOffsetArray.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  

for (let i = 0; i < posOffsetArray.length; i+=7) {
    posOffsetArray[i] = Math.random()*2-1;   // X
    posOffsetArray[i+1] = Math.random()*2-1; // Y

    posOffsetArray[i+2] = (Math.random()*2-1)*0.01;   // Force to X
    posOffsetArray[i+3] = (Math.random()*2-1)*0.01; // Force to Y

    posOffsetArray[i+4] = Math.random();   // R
    posOffsetArray[i+5] = Math.random();   // G
    posOffsetArray[i+6] = Math.random();   // B



  }
  device.queue.writeBuffer(posOffsetStorage, 0, posOffsetArray);
  




// define how the vertex data is stored in memory so the gpu knows how to access it
const vertexBufferLayout = {
    arrayStride: 8,
    attributes: [{
        format: "float32x2",
        offset: 0,
        shaderLocation: 0, // Position, see vertex shader
    }],
};




// our first webgpu shader
const cellShaderModule = device.createShaderModule({
    label: "Cell shader",
    code: `
        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) color: vec4f,
        };
      

        @group(0) @binding(0) var<storage> posOffset: array<f32>;
        

        @vertex
        fn vertexMain(@location(0) pos: vec2f,
                    @builtin(instance_index) instance: u32) -> VertexOutput {
        
        let x = f32(posOffset[instance*7]);
        let y = f32(posOffset[instance*7+1]);

        var output : VertexOutput;
        output.pos = vec4f(pos.x+x,pos.y+y, 0, 1);
        output.color = vec4f(posOffset[instance*7+4],posOffset[instance*7+5],posOffset[instance*7+6],1);

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
    layout: "auto",
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



// Bind storage to shader
const bindGroup = device.createBindGroup({
    layout: cellPipeline.getBindGroupLayout(0),
    entries: [
    {
      binding: 0,
      resource: { buffer: posOffsetStorage }
    }],
  });

  


  


function draw(){
    // Start a render pass 
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
    colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: "clear",
        clearValue: { r: 0, g: 0, b: 0.4, a: 1 }, // New line
        storeOp: "store",
        }],
    });

    // Draw the point

    pass.setPipeline(cellPipeline);

    pass.setVertexBuffer(0, buf);

    pass.setBindGroup(0, bindGroup);

    pass.draw(vertices.length/2,AMOUNT); 

    // End the render pass and submit the command buffer
    pass.end();
    device.queue.submit([encoder.finish()]);

}


setInterval(draw, 1000/60);



