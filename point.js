export class Point{

    constructor(x,y,width){

        let x2 = x+width;
        let y2 = y+width;

        this.x = x
        this.y = y
        this.width = width
        this.force = [0,0]

        this.setVertices(x,y,width)

    }


    allocateBuffer(device) {
		const buf = device.createBuffer({
            size: this.vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
		});
        device.queue.writeBuffer(buf, /*bufferOffset=*/0, this.vertices);
		return buf;
	}

    setVertices(x,y,width){

        var x2 = x+width;
        var y2 = y+width;

        this.vertices = new Float32Array([
            //   X,    Y,
            x, y,
            x2, y,
            x2, y2,

            x, y,
            x2, y2,
            x, y2,
        ]);        
    }


    move(dx,dy){

        this.x += dx;
        this.y += dy;

        this.setVertices(this.x,this.y,this.width);

    }

} 
