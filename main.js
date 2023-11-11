import {Point} from "./point.js"

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
        @vertex
        fn vertexMain(@location(0) pos: vec2f) ->
        @builtin(position) vec4f {
        return vec4f(pos.x,pos.y, 0, 1);
        }

        @fragment
        fn fragmentMain() -> @location(0) vec4f {
        return vec4f(1, 0, 0, 1);
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



var points = [];
for(let i = 0; i<100; i++){
    points.push(new Point(Math.random() * 2 - 1,Math.random() * 2 - 1, 0.01));
    points[points.length-1].force = [Math.random()/100, Math.random()/100]
}

// var point = new Point(-0.9, -0.9, 0.1);
// point.force = [0.01, 0.02];

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
    for(let point of points){
        point.move(point.force[0], point.force[1]);
        
        if(point.x > 1-point.width || point.x < -1)
            point.force[0] *= -1;

        if(point.y > 1-point.width || point.y < -1)
            point.force[1] *= -1;

        var pointVertices = point.allocateBuffer(device);
        pass.setVertexBuffer(0, pointVertices);
        pass.draw(point.vertices.length/2);
    }

    // End the render pass and submit the command buffer
    pass.end();
    device.queue.submit([encoder.finish()]);

}


setInterval(draw, 1000/60);



