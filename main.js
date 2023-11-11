import { Point } from "./point.js"
//import shaderWGSL from "./shader.wgsl"

const canvas = document.querySelector("canvas")
canvas.width = window.innerWidth
canvas.height = window.innerHeight


if (!navigator.gpu) {
    throw new Error("WebGPU not supported on this browser.");
}

const adapter = await navigator.gpu.requestAdapter()
const device = await adapter.requestDevice()
const context = canvas.getContext("webgpu")
const canvasFormat = navigator.gpu.getPreferredCanvasFormat()
context.configure({
    device: device,
    format: canvasFormat,
})

const num_points = 100;
const data = new Float32Array(num_points * 2) // x,y
for (let i = 0; i < 100; i++) {
    data[i] = Math.random() * 2 - 1;
}

const particleBuffers = new Array(2);
for (let i = 0; i < 2; ++i) {
    particleBuffers[i] = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
        mappedAtCreation: true,
    });
    new Float32Array(particleBuffers[i].getMappedRange()).set(
        data
    );
    particleBuffers[i].unmap();
}

// tell gpu how locations are formatted in gpu
const dataBufferLayout = {
    arrayStride: 8,
    attributes: [{
        format: "float32x2",
        offset: 0,
        shaderLocation: 0, // Position, see vertex shader
    }],
};

const vertexBufferData = new Float32Array([
    -0.01, -0.02,
    0.01, -0.02,
    0.0, 0.02,
]);

const vertexBuffer = device.createBuffer({
    size: vertexBufferData.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
});

new Float32Array(vertexBuffer.getMappedRange()).set(vertexBufferData);
vertexBuffer.unmap();

const shaderModule = device.createShaderModule({
    code: `
    struct VertexOutput {
        @builtin(position) position : vec4<f32>
        //@location(4) color : vec4<f32>,
      }
      
      @vertex
      fn vert_main(
        @location(0) pos : vec2<f32>
      ) -> VertexOutput {
        let delta_pos = vec2(
          (1.0),
          (1.0)
        );
        
        var output : VertexOutput;
        output.position = vec4(delta_pos.x + pos.x, delta_pos.y +pos.y, 0.0, 1.0);
        return output;
      }
      
      @fragment
      fn frag_main() -> @location(0) vec4<f32> {
        return vec4(1.0, 0.0, 0.0, 1.0);
      }
    `
});

const renderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
        module: shaderModule,
        entryPoint: 'vert_main',
        buffers: [
            {
                // instanced particles buffer
                arrayStride: 2 * 4,
                stepMode: 'instance',
                attributes: [
                    {
                        // instance position
                        shaderLocation: 0,
                        offset: 0,
                        format: 'float32x2',
                    },
                    //{
                    //    // instance velocity
                    //    shaderLocation: 1,
                    //    offset: 2 * 4,
                    //    format: 'float32x2',
                    //},
                ],
            },
            {
                // vertex buffer
                arrayStride: 2 * 4, //TODO: check this
                stepMode: 'vertex',
                attributes: [
                    {
                        // vertex positions
                        shaderLocation: 2,
                        offset: 0,
                        format: 'float32x2',
                    },
                ],
            },
        ],
    },
    fragment: {
        module: shaderModule,
        entryPoint: 'frag_main',
        targets: [
            {
                format: canvasFormat,
            },
        ],
    },
    primitive: {
        topology: 'triangle-list',
    },
});


function draw() {
    // Start a render pass 
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0.4, a: 1 },
            storeOp: "store",
        }],
    });

    // Draw the points
    pass.setPipeline(renderPipeline);
    pass.setVertexBuffer(0, particleBuffers[1]);
    pass.setVertexBuffer(1, vertexBuffer);
    pass.draw(3, num_points, 0, 0);

    // End the render pass and submit the command buffer
    pass.end();
    device.queue.submit([encoder.finish()]);
}

setInterval(draw, 1000 / 60);
