// High performance touch-friendly drawing canvas with smoothing, undo, neon brush, and image upload
class DrawingStudio {
    constructor(canvasId, containerId) {
        this.canvas = document.getElementById(canvasId);
        this.container = document.getElementById(containerId);
        this.ctx = this.canvas.getContext('2d');
        
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;
        this.currentColor = '#1e1e24';
        this.brushSize = 6;
        this.isEraser = false;
        this.isNeon = false;
        
        this.history = [];
        this.maxHistory = 25;

        this.initCanvasSize();
        this.bindEvents();
        this.clearCanvas(false);
    }

    initCanvasSize() {
        // Set internal resolution to 600x600 for sharp rendering on retina displays
        const width = 600;
        const height = 600;
        this.canvas.width = width;
        this.canvas.height = height;

        // Context defaults
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
    }

    bindEvents() {
        // Pointer / Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        window.addEventListener('mousemove', (e) => this.draw(e));
        window.addEventListener('mouseup', () => this.stopDrawing());

        // Touch events for mobile phones and tablets
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                e.preventDefault();
                this.startDrawing(e.touches[0]);
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1) {
                e.preventDefault();
                this.draw(e.touches[0]);
            }
        }, { passive: false });

        this.canvas.addEventListener('touchend', (e) => {
            this.stopDrawing();
        });

        this.canvas.addEventListener('touchcancel', () => {
            this.stopDrawing();
        });
    }

    getPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    startDrawing(e) {
        this.saveState();
        this.isDrawing = true;
        const pos = this.getPos(e);
        this.lastX = pos.x;
        this.lastY = pos.y;

        // Draw dot immediately on tap
        this.applyBrushStyle();
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y, this.brushSize / 2, 0, Math.PI * 2);
        this.ctx.fill();
    }

    draw(e) {
        if (!this.isDrawing) return;
        const pos = this.getPos(e);

        this.applyBrushStyle();
        this.ctx.beginPath();
        this.ctx.moveTo(this.lastX, this.lastY);
        // Midpoint quadratic curve for buttery smooth lines
        const midX = (this.lastX + pos.x) / 2;
        const midY = (this.lastY + pos.y) / 2;
        this.ctx.quadraticCurveTo(this.lastX, this.lastY, midX, midY);
        this.ctx.stroke();

        this.lastX = pos.x;
        this.lastY = pos.y;
    }

    stopDrawing() {
        if (this.isDrawing) {
            this.isDrawing = false;
        }
    }

    applyBrushStyle() {
        if (this.isEraser) {
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.fillStyle = '#ffffff';
            this.ctx.lineWidth = this.brushSize * 2.5;
            this.ctx.shadowBlur = 0;
        } else if (this.isNeon) {
            this.ctx.strokeStyle = this.currentColor;
            this.ctx.fillStyle = this.currentColor;
            this.ctx.lineWidth = this.brushSize;
            this.ctx.shadowBlur = 14;
            this.ctx.shadowColor = this.currentColor;
        } else {
            this.ctx.strokeStyle = this.currentColor;
            this.ctx.fillStyle = this.currentColor;
            this.ctx.lineWidth = this.brushSize;
            this.ctx.shadowBlur = 0;
        }
    }

    setColor(color) {
        this.currentColor = color;
        this.isEraser = false;
        if (window.sound) window.sound.playClick();
    }

    setBrushSize(size) {
        this.brushSize = size;
        if (window.sound) window.sound.playClick();
    }

    toggleEraser(active) {
        this.isEraser = active;
        if (window.sound) window.sound.playClick();
    }

    toggleNeon(active) {
        this.isNeon = active;
        if (window.sound) window.sound.playClick();
    }

    saveState() {
        if (this.history.length >= this.maxHistory) {
            this.history.shift();
        }
        this.history.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
    }

    undo() {
        if (this.history.length > 0) {
            const prevState = this.history.pop();
            this.ctx.putImageData(prevState, 0, 0);
            if (window.sound) window.sound.playClick();
        }
    }

    clearCanvas(recordHistory = true) {
        if (recordHistory) {
            this.saveState();
        }
        this.ctx.save();
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
        if (recordHistory && window.sound) window.sound.playClick();
    }

    // Load an uploaded user photo or drawing into canvas
    loadImageFile(file) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type.startsWith('image/')) {
                reject(new Error('請選擇有效的圖片檔案'));
                return;
            }
            this.saveState();

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    // Fill white background
                    this.ctx.fillStyle = '#ffffff';
                    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

                    // Fit image into 600x600 canvas preserving aspect ratio
                    const scale = Math.min(this.canvas.width / img.width, this.canvas.height / img.height);
                    const dw = img.width * scale;
                    const dh = img.height * scale;
                    const dx = (this.canvas.width - dw) / 2;
                    const dy = (this.canvas.height - dh) / 2;

                    this.ctx.drawImage(img, dx, dy, dw, dh);
                    if (window.sound) window.sound.playChime();
                    resolve();
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // Export optimized base64 image (JPEG with 0.82 quality, ~40-70KB)
    getCompressedDataUrl() {
        return this.canvas.toDataURL('image/jpeg', 0.82);
    }

    isCanvasEmpty() {
        // Quick sample test
        const imgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
        for (let i = 0; i < imgData.length; i += 16) {
            // Check if not white (255, 255, 255)
            if (imgData[i] < 240 || imgData[i + 1] < 240 || imgData[i + 2] < 240) {
                return false;
            }
        }
        return true;
    }
}

window.DrawingStudio = DrawingStudio;
