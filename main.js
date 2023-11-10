 
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

        // Our first shader and vertex code
        // Maybe use Index Buffers for more trianges instead of hard coding. 
        const vertices = new Float32Array([
            //   X,    Y,
            -0.8, -0.8, // Triangle 1 (Blue)
            0.8, -0.8,
            0.8, 0.8,

            -0.8, -0.8, // Triangle 2 (Red)
            0.8, 0.8,
            -0.8, 0.8,
        ]);

        // allocate gpu memory for vertice data
        const vertexBuffer = device.createBuffer({
            label: "Cell vertices",
            size: vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        // copy vertex data into gpu memory
        device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/0, vertices);

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

        // Actual rendering on gpu is done here with calls to the encoder object
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: "clear",
                clearValue: { r: 0, g: 0, b: 0.4, a: 1 }, // New line
                storeOp: "store",
            }],
        });

        pass.setPipeline(cellPipeline);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.draw(vertices.length / 2); // 6 vertices

        pass.end();
        const commandBuffer = encoder.finish();

        // the gpu queue performs all GPU commands
        device.queue.submit([commandBuffer]);
        device.queue.submit([encoder.finish()]);




