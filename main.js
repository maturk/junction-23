import { Point } from "./point.js"

const canvas = document.querySelector("canvas")
canvas.width = window.innerWidth
canvas.height = window.innerHeight

if (!navigator.gpu) {
    throw new Error("WebGPU not supported on this browser.");
}

const adapter = await navigator.gpu.requestAdapter()
const hasTimestampQuery = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({
    requiredFeatures: hasTimestampQuery ? ['timestamp-query'] : [],
});
const context = canvas.getContext("webgpu")
const canvasFormat = navigator.gpu.getPreferredCanvasFormat()
context.configure({
    device: device,
    format: canvasFormat,
})

const numParticles = 50000;
const simParams = {
    deltaT: 20,
};

const spriteShaderModule = device.createShaderModule({
    code: `
    struct VertexOutput {
        @builtin(position) position : vec4<f32>,
        @location(4) color : vec4<f32>,
      }
      
    @vertex
    fn vert_main(
    @location(0) a_particlePos : vec2<f32>,
    @location(1) a_particleVel : vec2<f32>,
    @location(2) a_pos : vec2<f32>
    ) -> VertexOutput {

    let angle = -atan2(a_particleVel.x, a_particleVel.y);
    let pos = vec2(
        (a_pos.x * cos(angle)) - (a_pos.y * sin(angle)),
        (a_pos.x * sin(angle)) + (a_pos.y * cos(angle))
    );
    
    var output : VertexOutput;
    output.position = vec4(pos + a_particlePos, 0.0, 1.0);
    output.color = vec4(1,0,0,0);
    
    return output;
    }
    
    @fragment
    fn frag_main(@location(4) color : vec4<f32>) -> @location(0) vec4<f32> {
    return color;
    }
    `
});

const renderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
        module: spriteShaderModule,
        entryPoint: 'vert_main',
        buffers: [
            {
                // instanced particles buffer
                arrayStride: 4 * 4,
                stepMode: 'instance',
                attributes: [
                    {
                        // instance position
                        shaderLocation: 0,
                        offset: 0,
                        format: 'float32x2',
                    },
                    {
                        // instance velocity
                        shaderLocation: 1,
                        offset: 2 * 4,
                        format: 'float32x2',
                    },
                ],
            },
            {
                // vertex buffer
                arrayStride: 2 * 4,
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
        module: spriteShaderModule,
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

const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
        module: device.createShaderModule({
            code: `
            struct Particle {
                pos : vec2<f32>,
                vel : vec2<f32>,
              }
              struct SimParams {
                deltaT : f32,
              }
              struct Particles {
                particles : array<Particle>,
              }
              @binding(0) @group(0) var<uniform> params : SimParams;
              @binding(1) @group(0) var<storage, read> particlesA : Particles;
              @binding(2) @group(0) var<storage, read_write> particlesB : Particles;
              @group(0) @binding(3) var<uniform> click: vec2f;

              @compute @workgroup_size(64)
              fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
                var index = GlobalInvocationID.x;
              
                var vPos = particlesA.particles[index].pos;
                var vVel = particlesA.particles[index].vel;
                var pos : vec2<f32>;
                var vel : vec2<f32>;
              
                for (var i = 0u; i < arrayLength(&particlesA.particles); i++) {
                  if (i == index) {
                    continue;
                  }
              
                  pos = particlesA.particles[i].pos.xy;
                  vel = particlesA.particles[i].vel.xy;
                }
              
                // clamp velocity for a more pleasing simulation
                vVel = normalize(vVel) * clamp(length(vVel), 0.0, 0.1);
                
                // kinematic update
                vPos = vPos + (vVel * params.deltaT);

                // Wrap around boundary
                if (vPos.x < -1.0) {
                  //vPos.x = 1.0;
                  vVel.x = -vVel.x;
                }
                if (vPos.x > 1.0) {
                  //vPos.x = -1.0;
                  vVel.x = -vVel.x;
                }
                if (vPos.y < -1.0) {
                  //vPos.y = 1.0;
                  vVel.y = -vVel.y;
                }
                if (vPos.y > 1.0) {
                  //vPos.y = -1.0;
                  vVel.y = -vVel.y;
                }
                // Write back
                particlesB.particles[index].pos = vPos;
                particlesB.particles[index].vel = vVel;
              }
        `,
        }),
        entryPoint: 'main',
    },
});

const renderPassDescriptor = {
    colorAttachments: [
        {
            view: context.getCurrentTexture().createView(), // Assigned later
            clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
        },
    ],
};

const computePassDescriptor = {};

/** Storage for timestamp query results */
let querySet = undefined;
/** Timestamps are resolved into this buffer */
let resolveBuffer = undefined;
/** Pool of spare buffers for MAP_READing the timestamps back to CPU. A buffer
 * is taken from the pool (if available) when a readback is needed, and placed
 * back into the pool once the readback is done and it's unmapped. */
const spareResultBuffers = [];

if (hasTimestampQuery) {
    querySet = device.createQuerySet({
        type: 'timestamp',
        count: 4,
    });
    resolveBuffer = device.createBuffer({
        size: 4 * BigInt64Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    computePassDescriptor.timestampWrites = {
        querySet,
        beginningOfPassWriteIndex: 0,
        endOfPassWriteIndex: 1,
    };
    renderPassDescriptor.timestampWrites = {
        querySet,
        beginningOfPassWriteIndex: 2,
        endOfPassWriteIndex: 3,
    };
}

const vertexBufferData = new Float32Array([
    //-0.01, -0.02,
    //0.01, -0.02,
    //0.0, 0.02,
    0, 0,
    0.01, 0,
    0.01, 0.01,

    0, 0,
    0.01, 0.01,
    0, 0.01,
]);

const spriteVertexBuffer = device.createBuffer({
    size: vertexBufferData.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
});
new Float32Array(spriteVertexBuffer.getMappedRange()).set(vertexBufferData);
spriteVertexBuffer.unmap();

const simParamBufferSize = 1 * Float32Array.BYTES_PER_ELEMENT;
const simParamBuffer = device.createBuffer({
    size: simParamBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

function updateSimParams() {
    device.queue.writeBuffer(
        simParamBuffer,
        0,
        new Float32Array([
            simParams.deltaT,
        ])
    );
}
updateSimParams();

const initialParticleData = new Float32Array(numParticles * 4);
for (let i = 0; i < numParticles; ++i) {
    initialParticleData[4 * i + 0] = 2 * (Math.random() - 0.5); // x
    initialParticleData[4 * i + 1] = 2 * (Math.random() - 0.5); // y
    initialParticleData[4 * i + 2] = 0.001; // vel x
    initialParticleData[4 * i + 3] = 0.001; // vel y
}

const particleBuffers = new Array(2);
const particleBindGroups = new Array(2);
for (let i = 0; i < 2; ++i) {
    particleBuffers[i] = device.createBuffer({
        size: initialParticleData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE,
        mappedAtCreation: true,
    });
    new Float32Array(particleBuffers[i].getMappedRange()).set(
        initialParticleData
    );
    particleBuffers[i].unmap();
}

for (let i = 0; i < 2; ++i) {
    particleBindGroups[i] = device.createBindGroup({
        layout: computePipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: simParamBuffer,
                },
            },
            {
                binding: 1,
                resource: {
                    buffer: particleBuffers[i],
                    offset: 0,
                    size: initialParticleData.byteLength,
                },
            },
            {
                binding: 2,
                resource: {
                    buffer: particleBuffers[(i + 1) % 2],
                    offset: 0,
                    size: initialParticleData.byteLength,
                },
            },
        ],
    });
}

let t = 0;
let computePassDurationSum = 0;
let renderPassDurationSum = 0;

// canvas click buffer
const click = new Float32Array([0.0, 0.0]);
const clickBuffer = device.createBuffer({
    label: "Grid Uniforms",
    size: click.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

canvas.addEventListener("click", (ev) => {
    let x = ev.offsetX / window.innerWidth * 2 - 1;
    let y = ev.offsetY / window.innerHeight * 2 - 1;
    click.x = x;
    click.y = y;
    device.queue.writeBuffer(clickBuffer, 0, click);
});

function frame() {
    renderPassDescriptor.colorAttachments[0].view = context
        .getCurrentTexture()
        .createView();

    const commandEncoder = device.createCommandEncoder();
    {
        const passEncoder = commandEncoder.beginComputePass(
            computePassDescriptor
        );
        passEncoder.setPipeline(computePipeline);
        passEncoder.setBindGroup(0, particleBindGroups[t % 2]);
        passEncoder.dispatchWorkgroups(Math.ceil(numParticles / 64));
        passEncoder.end();
    }
    {
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(renderPipeline);
        passEncoder.setVertexBuffer(0, particleBuffers[(t + 1) % 2]);
        passEncoder.setVertexBuffer(1, spriteVertexBuffer);
        //passEncoder.draw(3, numParticles, 0, 0);
        passEncoder.draw(6, numParticles, 0, 0);
        passEncoder.end();
    }

    device.queue.submit([commandEncoder.finish()]);

    ++t;
    //requestAnimationFrame(frame);
};

setInterval(frame, 2000 / 60);