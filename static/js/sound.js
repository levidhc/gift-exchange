// Procedural sound effects using Web Audio API (zero external audio files needed)
class SoundManager {
    constructor() {
        this.ctx = null;
        this.isMuted = localStorage.getItem('sound_muted') === 'true';
    }

    init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.ctx = new AudioContext();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        localStorage.setItem('sound_muted', this.isMuted);
        return this.isMuted;
    }

    playClick() {
        if (this.isMuted) return;
        this.init();
        if (!this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            const now = this.ctx.currentTime;
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + 0.05);
        } catch (e) {
            console.error(e);
        }
    }

    playChime() {
        if (this.isMuted) return;
        this.init();
        if (!this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            const freqs = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
            freqs.forEach((freq, idx) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'triangle';
                const startTime = now + idx * 0.08;
                osc.frequency.setValueAtTime(freq, startTime);
                gain.gain.setValueAtTime(0.25, startTime);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(startTime);
                osc.stop(startTime + 0.35);
            });
        } catch (e) {
            console.error(e);
        }
    }

    playShuffle() {
        if (this.isMuted) return;
        this.init();
        if (!this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            for (let i = 0; i < 12; i++) {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'square';
                const t = now + i * 0.06;
                const freq = 300 + Math.random() * 500;
                osc.frequency.setValueAtTime(freq, t);
                gain.gain.setValueAtTime(0.08, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(t);
                osc.stop(t + 0.04);
            }
        } catch (e) {
            console.error(e);
        }
    }

    playCorrect() {
        if (this.isMuted) return;
        this.init();
        if (!this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            // Celebratory fanfare: C5 -> E5 -> G5 -> C6 held
            const notes = [
                { f: 523.25, d: 0.1, delay: 0 },
                { f: 659.25, d: 0.1, delay: 0.1 },
                { f: 783.99, d: 0.15, delay: 0.2 },
                { f: 1046.50, d: 0.5, delay: 0.35 }
            ];
            notes.forEach(n => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'triangle';
                const t = now + n.delay;
                osc.frequency.setValueAtTime(n.f, t);
                gain.gain.setValueAtTime(0.3, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + n.d);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(t);
                osc.stop(t + n.d);
            });
        } catch (e) {
            console.error(e);
        }
    }

    playWrong() {
        if (this.isMuted) return;
        this.init();
        if (!this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            // Cartoon sliding down sound
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(320, now);
            osc.frequency.exponentialRampToValueAtTime(140, now + 0.35);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(now);
            osc.stop(now + 0.35);
        } catch (e) {
            console.error(e);
        }
    }

    playPartyCheer() {
        if (this.isMuted) return;
        this.init();
        if (!this.ctx) return;
        try {
            this.playCorrect();
            setTimeout(() => this.playChime(), 300);
        } catch (e) {
            console.error(e);
        }
    }
}

window.sound = new SoundManager();
