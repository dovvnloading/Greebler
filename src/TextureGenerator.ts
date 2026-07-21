import {
  generationParamsFromRecipe,
  getGenerationRecipeId,
  normalizeGenerationRecipe,
  type GenerationParams,
  type GenerationRecipe,
} from './recipes';

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Greebler requires a browser with 2D canvas support. Try a current desktop browser.');
  }
  return context;
}

export type { GenerationParams, GenerationRecipe } from './recipes';

type PanelTier = 'large' | 'medium' | 'small';

interface PanelShape {
  x: number;
  y: number;
  w: number;
  h: number;
  cornerSize: number;
  corners: [boolean, boolean, boolean, boolean];
}

export class TextureGenerator {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private albedoCanvas: HTMLCanvasElement;
  private albedoCtx: CanvasRenderingContext2D;
  private materialAlbedoCanvas: HTMLCanvasElement;
  private materialAlbedoCtx: CanvasRenderingContext2D;
  private roughnessCanvas: HTMLCanvasElement;
  private roughnessCtx: CanvasRenderingContext2D;
  private metalnessCanvas: HTMLCanvasElement;
  private metalnessCtx: CanvasRenderingContext2D;
  private recipe: GenerationRecipe;
  private params: GenerationParams;
  private randomSeed: number;
  private scale: number;

  constructor(input: GenerationParams | GenerationRecipe) {
    this.recipe = normalizeGenerationRecipe(input);
    const params = generationParamsFromRecipe(this.recipe);
    this.params = params;
    this.scale = params.resolution / 1024;

    // Height Map (Main)
    this.canvas = document.createElement('canvas');
    this.canvas.width = params.resolution;
    this.canvas.height = params.resolution;
    this.ctx = getCanvasContext(this.canvas);

    // Albedo Map
    this.albedoCanvas = document.createElement('canvas');
    this.albedoCanvas.width = params.resolution;
    this.albedoCanvas.height = params.resolution;
    this.albedoCtx = getCanvasContext(this.albedoCanvas);

    // Keep authored material colors separate from the height-derived albedo
    // pass. The latter is generated after subdivision and must not erase
    // material-specific overlays such as wires and pipes.
    this.materialAlbedoCanvas = document.createElement('canvas');
    this.materialAlbedoCanvas.width = params.resolution;
    this.materialAlbedoCanvas.height = params.resolution;
    this.materialAlbedoCtx = getCanvasContext(this.materialAlbedoCanvas);

    // Roughness Map
    this.roughnessCanvas = document.createElement('canvas');
    this.roughnessCanvas.width = params.resolution;
    this.roughnessCanvas.height = params.resolution;
    this.roughnessCtx = getCanvasContext(this.roughnessCanvas);

    // Metalness Map
    this.metalnessCanvas = document.createElement('canvas');
    this.metalnessCanvas.width = params.resolution;
    this.metalnessCanvas.height = params.resolution;
    this.metalnessCtx = getCanvasContext(this.metalnessCanvas);

    this.randomSeed = params.seed;
  }

  public getRecipe(): GenerationRecipe {
    return normalizeGenerationRecipe(this.recipe);
  }

  public getRecipeId(): string {
    return getGenerationRecipeId(this.recipe);
  }

  private random() {
    const x = Math.sin(this.randomSeed++) * 10000;
    return x - Math.floor(x);
  }

  private randomRange(min: number, max: number) {
    return min + this.random() * (max - min);
  }

  private randomInt(min: number, max: number) {
    return Math.floor(this.randomRange(min, max + 1));
  }

  public generateMaps(): { albedo: string; height: string; normal: string; roughness: string; metalness: string } {
    this.randomSeed = this.params.seed;

    // Initialize all maps
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Base Albedo (Palette[0])
    this.albedoCtx.fillStyle = this.params.palette[0] || '#1a1a1a';
    this.albedoCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.materialAlbedoCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Base Roughness (Matte background)
    this.roughnessCtx.fillStyle = '#cccccc'; // 0.8
    this.roughnessCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Base Metalness (Non-metal background)
    this.metalnessCtx.fillStyle = '#000000'; // 0.0
    this.metalnessCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw faint grid background (Height only)
    this.ctx.strokeStyle = '#111111';
    this.ctx.lineWidth = 1;
    const gridSize = 32 * this.scale;
    for (let i = 0; i < this.canvas.width; i += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(i, 0);
      this.ctx.lineTo(i, this.canvas.height);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(0, i);
      this.ctx.lineTo(this.canvas.width, i);
      this.ctx.stroke();
    }

    // Start recursive subdivision
    const gap = this.params.gapSize * this.scale;
    this.subdivide(gap, gap, this.canvas.width - gap * 2, this.canvas.height - gap * 2, 0);

    const heightDataUrl = this.canvas.toDataURL('image/png');

    // 2. Generate Albedo Map (Colorizer - Discrete Levels)
    // We overwrite the PBR albedo with the discrete color map based on height levels.
    // This creates distinct bands of color rather than a smooth gradient.
    this.albedoCtx.drawImage(this.canvas, 0, 0);
    const albedoImgData = this.albedoCtx.getImageData(0, 0, this.canvas.width, this.canvas.height);

    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16),
          }
        : { r: 0, g: 0, b: 0 };
    };

    const rgbPalette = this.params.palette.map(hexToRgb);
    const numColors = rgbPalette.length;

    for (let i = 0; i < albedoImgData.data.length; i += 4) {
      const h = albedoImgData.data[i]; // Use red channel as height

      // Map height (0-255) to a discrete palette index
      // We use Math.floor to create hard steps between colors
      const colorIndex = Math.min(numColors - 1, Math.floor((h / 256) * numColors));

      const color = rgbPalette[colorIndex];

      // Add a tiny bit of noise to break up perfect uniformity within bands, if desired
      // But for now, we stick to the requested "mapped based on lightness levels"

      albedoImgData.data[i] = color.r;
      albedoImgData.data[i + 1] = color.g;
      albedoImgData.data[i + 2] = color.b;
      albedoImgData.data[i + 3] = 255; // Alpha
    }
    this.albedoCtx.putImageData(albedoImgData, 0, 0);

    // Re-apply authored material colors after the height-to-palette pass.
    // Drawing the height canvas directly into the final albedo would
    // otherwise overwrite these overlays while leaving roughness/metalness
    // unchanged, producing an inconsistent PBR set.
    this.albedoCtx.drawImage(this.materialAlbedoCanvas, 0, 0);

    const albedoDataUrl = this.albedoCanvas.toDataURL('image/png');
    const roughnessDataUrl = this.roughnessCanvas.toDataURL('image/png');
    const metalnessDataUrl = this.metalnessCanvas.toDataURL('image/png');

    // Generate Normal Map from Height Map
    const normalCanvas = document.createElement('canvas');
    normalCanvas.width = this.canvas.width;
    normalCanvas.height = this.canvas.height;
    const normalCtx = getCanvasContext(normalCanvas);
    const heightImgData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const normalImgData = normalCtx.createImageData(this.canvas.width, this.canvas.height);

    const width = this.canvas.width;
    const height = this.canvas.height;
    const strength = 5.0 * this.scale;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;

        // Get neighboring heights (handling edges)
        const hL = x > 0 ? heightImgData.data[(y * width + (x - 1)) * 4] / 255 : heightImgData.data[idx] / 255;
        const hR = x < width - 1 ? heightImgData.data[(y * width + (x + 1)) * 4] / 255 : heightImgData.data[idx] / 255;
        const hU = y > 0 ? heightImgData.data[((y - 1) * width + x) * 4] / 255 : heightImgData.data[idx] / 255;
        const hD = y < height - 1 ? heightImgData.data[((y + 1) * width + x) * 4] / 255 : heightImgData.data[idx] / 255;

        // Sobel operator approximation
        const dx = (hR - hL) * strength;
        const dy = (hD - hU) * strength;
        const dz = 1.0;

        // Normalize
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const nx = dx / len;
        const ny = dy / len;
        const nz = dz / len;

        // Map to 0-255
        normalImgData.data[idx] = Math.floor((nx + 1.0) * 0.5 * 255);
        normalImgData.data[idx + 1] = Math.floor((ny + 1.0) * 0.5 * 255);
        normalImgData.data[idx + 2] = Math.floor(nz * 255);
        normalImgData.data[idx + 3] = 255; // Alpha
      }
    }
    normalCtx.putImageData(normalImgData, 0, 0);
    const normalDataUrl = normalCanvas.toDataURL('image/png');

    return {
      albedo: albedoDataUrl,
      height: heightDataUrl,
      normal: normalDataUrl,
      roughness: roughnessDataUrl,
      metalness: metalnessDataUrl,
    };
  }

  private drawElectricalPanel(x: number, y: number, w: number, h: number, tier: 'large' | 'medium' | 'small') {
    const isRecessed = this.random() < 0.4;

    if (isRecessed) {
      // Draw recessed area with wires
      const baseHeight = this.randomRange(20, 40);
      this.drawOrthogonalWireBundle(x, y, w, h, baseHeight);
    } else {
      // Draw raised panel
      const baseHeight = this.randomRange(80, 120);
      this.ctx.fillStyle = `rgb(${Math.max(0, baseHeight - 30)}, ${Math.max(0, baseHeight - 30)}, ${Math.max(0, baseHeight - 30)})`;
      this.ctx.fillRect(x, y, w, h);
      this.ctx.fillStyle = `rgb(${baseHeight}, ${baseHeight}, ${baseHeight})`;
      this.ctx.fillRect(x + 2 * this.scale, y + 2 * this.scale, w - 4 * this.scale, h - 4 * this.scale);

      const margin = 6 * this.scale;
      const ix = x + margin;
      const iy = y + margin;
      const iw = w - margin * 2;
      const ih = h - margin * 2;

      if (iw < 8 * this.scale || ih < 8 * this.scale) return;

      const r = this.random();
      if (tier === 'large') {
        if (r < 0.4) this.drawJunctionBox(ix, iy, iw, ih, baseHeight);
        else if (r < 0.7) this.drawCircuitBoard(ix, iy, iw, ih, baseHeight);
        else this.drawStraightWireBundle(ix, iy, iw, ih, baseHeight);
      } else if (tier === 'medium') {
        if (r < 0.3) this.drawRibbedPipe(ix, iy, iw, ih, baseHeight);
        else if (r < 0.6) this.drawCircuitBoard(ix, iy, iw, ih, baseHeight);
        else if (r < 0.8) this.drawTerminals(ix, iy, iw, ih, baseHeight);
        else this.drawStraightWireBundle(ix, iy, iw, ih, baseHeight);
      } else {
        if (r < 0.4) this.drawMicrochip(ix, iy, iw, ih, baseHeight);
        else if (r < 0.7) this.drawTerminals(ix, iy, iw, ih, baseHeight);
        else this.drawCircuitTraces(ix, iy, iw, ih, baseHeight);
      }

      // Bolts on corners
      if (this.random() < 0.5) {
        this.drawBolts(x + 2 * this.scale, y + 2 * this.scale, w - 4 * this.scale, h - 4 * this.scale, baseHeight);
      }
    }
  }

  private drawOrthogonalWireBundle(x: number, y: number, w: number, h: number, baseHeight: number) {
    this.ctx.fillStyle = `rgb(${baseHeight}, ${baseHeight}, ${baseHeight})`;
    this.ctx.fillRect(x, y, w, h);
    this.ctx.fillStyle = `rgba(0, 0, 0, 0.5)`;
    this.ctx.fillRect(x, y, w, 4 * this.scale);
    this.ctx.fillRect(x, y, 4 * this.scale, h);

    const numWires = this.randomInt(3, 8);
    const spacing = Math.min(w, h) / (numWires + 2);
    const radius = (spacing * 0.7) / 2;
    const wireHeight = baseHeight + this.randomRange(10, 30);
    const heightScale = this.randomRange(30, 50);

    // 0: Left to Bottom, 1: Left to Top, 2: Top to Right, 3: Top to Left
    const pattern = this.randomInt(0, 3);
    const turnX = x + w * this.randomRange(0.3, 0.7);
    const turnY = y + h * this.randomRange(0.3, 0.7);

    for (let i = 0; i < numWires; i++) {
      const offset = (i - (numWires - 1) / 2) * spacing;
      const points = [];

      if (pattern === 0) {
        // Left to Bottom
        points.push({ x: x, y: turnY + offset });
        points.push({ x: turnX + offset, y: turnY + offset });
        points.push({ x: turnX + offset, y: y + h });
      } else if (pattern === 1) {
        // Left to Top
        points.push({ x: x, y: turnY + offset });
        points.push({ x: turnX - offset, y: turnY + offset });
        points.push({ x: turnX - offset, y: y });
      } else if (pattern === 2) {
        // Top to Right
        points.push({ x: turnX + offset, y: y });
        points.push({ x: turnX + offset, y: turnY + offset });
        points.push({ x: x + w, y: turnY + offset });
      } else {
        // Top to Left
        points.push({ x: turnX + offset, y: y });
        points.push({ x: turnX + offset, y: turnY - offset });
        points.push({ x: x, y: turnY - offset });
      }
      this.drawSmoothWire(points, radius, wireHeight, heightScale);
    }
  }

  private drawStraightWireBundle(x: number, y: number, w: number, h: number, baseHeight: number) {
    const isHorizontal = w > h;
    const numWires = this.randomInt(2, Math.max(2, Math.floor((isHorizontal ? h : w) / (12 * this.scale))));
    const spacing = (isHorizontal ? h : w) / numWires;
    const radius = (spacing * 0.8) / 2;

    for (let i = 0; i < numWires; i++) {
      const wireHeight = baseHeight + this.randomRange(20, 60);
      const heightScale = this.randomRange(30, 60);

      if (isHorizontal) {
        const py = y + spacing * i + spacing / 2;
        this.drawSmoothWire(
          [
            { x: x, y: py },
            { x: x + w, y: py },
          ],
          radius,
          wireHeight,
          heightScale,
        );
      } else {
        const px = x + spacing * i + spacing / 2;
        this.drawSmoothWire(
          [
            { x: px, y: y },
            { x: px, y: y + h },
          ],
          radius,
          wireHeight,
          heightScale,
        );
      }
    }

    // Draw brackets
    if (this.random() < 0.7) {
      const numBrackets = this.randomInt(1, 3);
      this.ctx.fillStyle = `rgb(${baseHeight + 40}, ${baseHeight + 40}, ${baseHeight + 40})`;
      for (let i = 0; i < numBrackets; i++) {
        if (isHorizontal) {
          const bx = x + this.randomRange(0.2, 0.8) * w;
          this.ctx.fillRect(bx, y, 8 * this.scale, h);
          this.drawBolts(bx, y, 8 * this.scale, h, baseHeight + 40);
        } else {
          const by = y + this.randomRange(0.2, 0.8) * h;
          this.ctx.fillRect(x, by, w, 8 * this.scale);
          this.drawBolts(x, by, w, 8 * this.scale, baseHeight + 40);
        }
      }
    }
  }

  private drawRibbedPipe(x: number, y: number, w: number, h: number, baseHeight: number) {
    const isHorizontal = w > h;
    const radius = Math.min(w, h) * 0.3;
    const pipeHeight = baseHeight + 40;
    const cx = x + w / 2;
    const cy = y + h / 2;

    // Draw base pipe
    if (isHorizontal) {
      this.drawSmoothWire(
        [
          { x: x, y: cy },
          { x: x + w, y: cy },
        ],
        radius,
        pipeHeight,
        50,
        'pipe',
      );
    } else {
      this.drawSmoothWire(
        [
          { x: cx, y: y },
          { x: cx, y: y + h },
        ],
        radius,
        pipeHeight,
        50,
        'pipe',
      );
    }

    // Draw ribs
    const ribSpacing = 6 * this.scale;
    const ribRadius = radius + 2 * this.scale;

    if (isHorizontal) {
      for (let px = x + ribSpacing; px < x + w - ribSpacing; px += ribSpacing) {
        this.drawSmoothWire(
          [
            { x: px, y: cy },
            { x: px + 2 * this.scale, y: cy },
          ],
          ribRadius,
          pipeHeight,
          50,
          'pipe',
        );
      }
    } else {
      for (let py = y + ribSpacing; py < y + h - ribSpacing; py += ribSpacing) {
        this.drawSmoothWire(
          [
            { x: cx, y: py },
            { x: cx, y: py + 2 * this.scale },
          ],
          ribRadius,
          pipeHeight,
          50,
          'pipe',
        );
      }
    }
  }

  private drawCircuitBoard(x: number, y: number, w: number, h: number, baseHeight: number) {
    const margin = 8 * this.scale;
    const bx = x + margin;
    const by = y + margin;
    const bw = w - margin * 2;
    const bh = h - margin * 2;

    if (bw < 20 * this.scale || bh < 20 * this.scale) return;

    const boardHeight = baseHeight + 10;
    this.ctx.fillStyle = `rgb(${boardHeight}, ${boardHeight}, ${boardHeight})`;
    this.ctx.fillRect(bx, by, bw, bh);

    // Draw traces
    this.drawCircuitTraces(bx, by, bw, bh, boardHeight);

    // Draw chips
    const numChips = this.randomInt(1, 4);
    for (let i = 0; i < numChips; i++) {
      const cw = this.randomRange(10, 30) * this.scale;
      const ch = this.randomRange(10, 30) * this.scale;
      const cx = bx + this.randomRange(0, bw - cw);
      const cy = by + this.randomRange(0, bh - ch);
      this.drawMicrochip(cx, cy, cw, ch, boardHeight + 10);
    }
  }

  private drawTerminals(x: number, y: number, w: number, h: number, baseHeight: number) {
    const isHorizontal = w > h;
    const termHeight = baseHeight + 30;

    this.ctx.fillStyle = `rgb(${termHeight}, ${termHeight}, ${termHeight})`;
    this.ctx.fillRect(x + 4 * this.scale, y + 4 * this.scale, w - 8 * this.scale, h - 8 * this.scale);

    const spacing = 12 * this.scale;
    this.ctx.fillStyle = `rgb(${Math.max(0, termHeight - 40)}, ${Math.max(0, termHeight - 40)}, ${Math.max(0, termHeight - 40)})`;

    if (isHorizontal) {
      for (let px = x + spacing; px < x + w - spacing; px += spacing) {
        this.ctx.fillRect(px, y + 8 * this.scale, 4 * this.scale, h - 16 * this.scale);
        // Screw
        this.ctx.fillStyle = `rgb(${termHeight + 20}, ${termHeight + 20}, ${termHeight + 20})`;
        this.ctx.beginPath();
        this.ctx.arc(px + 2 * this.scale, y + h / 2, 2 * this.scale, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = `rgb(${Math.max(0, termHeight - 40)}, ${Math.max(0, termHeight - 40)}, ${Math.max(0, termHeight - 40)})`;
      }
    } else {
      for (let py = y + spacing; py < y + h - spacing; py += spacing) {
        this.ctx.fillRect(x + 8 * this.scale, py, w - 16 * this.scale, 4 * this.scale);
        // Screw
        this.ctx.fillStyle = `rgb(${termHeight + 20}, ${termHeight + 20}, ${termHeight + 20})`;
        this.ctx.beginPath();
        this.ctx.arc(x + w / 2, py + 2 * this.scale, 2 * this.scale, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = `rgb(${Math.max(0, termHeight - 40)}, ${Math.max(0, termHeight - 40)}, ${Math.max(0, termHeight - 40)})`;
      }
    }
  }

  private drawJunctionBox(x: number, y: number, w: number, h: number, baseHeight: number) {
    const boxHeight = baseHeight + this.randomRange(60, 100);
    const bevel = 4 * this.scale;

    this.ctx.fillStyle = `rgb(${Math.max(0, boxHeight - 50)}, ${Math.max(0, boxHeight - 50)}, ${Math.max(0, boxHeight - 50)})`;
    this.ctx.fillRect(x, y, w, h);

    this.ctx.fillStyle = `rgb(${boxHeight}, ${boxHeight}, ${boxHeight})`;
    this.ctx.fillRect(x + bevel, y + bevel, w - bevel * 2, h - bevel * 2);

    this.drawBolts(x + bevel, y + bevel, w - bevel * 2, h - bevel * 2, boxHeight);

    // Add a central feature
    if (w > 32 * this.scale && h > 32 * this.scale) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const r = Math.min(w, h) * 0.2;
      this.drawWireCap(cx, cy, r, boxHeight + 40);
    }
  }

  private drawMicrochip(x: number, y: number, w: number, h: number, baseHeight: number) {
    const chipW = w * 0.5;
    const chipH = h * 0.5;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const chipX = cx - chipW / 2;
    const chipY = cy - chipH / 2;

    // Pins
    this.ctx.fillStyle = `rgb(${baseHeight + 60}, ${baseHeight + 60}, ${baseHeight + 60})`;
    const pinSpacing = 6 * this.scale;
    const pinWidth = 2 * this.scale;

    if (w > h) {
      // Pins on top and bottom
      for (let px = chipX + pinSpacing; px < chipX + chipW - pinSpacing; px += pinSpacing) {
        this.ctx.fillRect(px, y + h * 0.1, pinWidth, h * 0.8);
      }
    } else {
      // Pins on left and right
      for (let py = chipY + pinSpacing; py < chipY + chipH - pinSpacing; py += pinSpacing) {
        this.ctx.fillRect(x + w * 0.1, py, w * 0.8, pinWidth);
      }
    }

    // Chip body
    const chipColor = baseHeight + 10;
    this.ctx.fillStyle = `rgb(${Math.max(0, chipColor - 20)}, ${Math.max(0, chipColor - 20)}, ${Math.max(0, chipColor - 20)})`;
    this.ctx.fillRect(chipX, chipY, chipW, chipH);
    this.ctx.fillStyle = `rgb(${chipColor}, ${chipColor}, ${chipColor})`;
    this.ctx.fillRect(chipX + 2 * this.scale, chipY + 2 * this.scale, chipW - 4 * this.scale, chipH - 4 * this.scale);

    // Dimple
    this.ctx.fillStyle = `rgb(${Math.max(0, chipColor - 30)}, ${Math.max(0, chipColor - 30)}, ${Math.max(0, chipColor - 30)})`;
    this.ctx.beginPath();
    this.ctx.arc(chipX + 6 * this.scale, chipY + 6 * this.scale, 2 * this.scale, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private drawCircuitTraces(x: number, y: number, w: number, h: number, baseHeight: number) {
    const traceColor = baseHeight + 50;
    this.ctx.strokeStyle = `rgb(${traceColor}, ${traceColor}, ${traceColor})`;
    this.ctx.fillStyle = `rgb(${traceColor}, ${traceColor}, ${traceColor})`;
    this.ctx.lineWidth = 2 * this.scale;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    const numTraces = this.randomInt(2, 5);
    for (let i = 0; i < numTraces; i++) {
      const startX = x + this.randomRange(0.1, 0.9) * w;
      const startY = y + this.randomRange(0.1, 0.9) * h;
      const midX = x + this.randomRange(0.1, 0.9) * w;
      const endY = y + this.randomRange(0.1, 0.9) * h;

      this.ctx.beginPath();
      this.ctx.moveTo(startX, startY);
      if (this.random() < 0.5) {
        this.ctx.lineTo(midX, startY);
        this.ctx.lineTo(midX, endY);
      } else {
        this.ctx.lineTo(startX, endY);
        this.ctx.lineTo(midX, endY);
      }
      this.ctx.stroke();

      // Vias
      this.ctx.beginPath();
      this.ctx.arc(startX, startY, 3 * this.scale, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.beginPath();
      this.ctx.arc(midX, endY, 3 * this.scale, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private drawSmoothWire(
    points: { x: number; y: number }[],
    radius: number,
    baseHeight: number,
    heightScale: number,
    materialType: 'wire' | 'pipe' = 'wire',
  ) {
    if (points.length < 2) return;

    // 1. Draw shadow underneath (Height only)
    this.ctx.strokeStyle = `rgb(${Math.max(0, baseHeight - 40)}, ${Math.max(0, baseHeight - 40)}, ${Math.max(0, baseHeight - 40)})`;
    this.ctx.lineWidth = radius * 2 + 4 * this.scale;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.beginPath();
    this.ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.ctx.lineTo(points[i].x, points[i].y);
    }
    this.ctx.stroke();

    // Material Properties
    let albedoColor = this.params.palette[2] || '#b87333'; // Default Copper
    let roughness = 0.3;
    let metalness = 1.0;

    if (materialType === 'pipe') {
      albedoColor = this.params.palette[1] || '#555555';
      roughness = 0.6;
      metalness = 0.8;
    } else {
      // Randomize wire colors slightly based on palette
      const r = this.random();
      if (r < 0.33) albedoColor = this.params.palette[2] || '#b87333';
      else if (r < 0.66) albedoColor = this.params.palette[3] || '#333333';
      else albedoColor = this.params.palette[4] || '#cc0000';

      // If it's the dark wire (rubber), make it matte and non-metal
      if (albedoColor === (this.params.palette[3] || '#333333')) {
        roughness = 0.9;
        metalness = 0.0;
      }
    }

    // Draw Albedo, Roughness, Metalness (Solid Lines)
    this.materialAlbedoCtx.strokeStyle = albedoColor;
    this.materialAlbedoCtx.lineWidth = radius * 2;
    this.materialAlbedoCtx.lineCap = 'round';
    this.materialAlbedoCtx.lineJoin = 'round';
    this.materialAlbedoCtx.beginPath();
    this.materialAlbedoCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) this.materialAlbedoCtx.lineTo(points[i].x, points[i].y);
    this.materialAlbedoCtx.stroke();

    const roughVal = Math.floor(roughness * 255);
    this.roughnessCtx.strokeStyle = `rgb(${roughVal}, ${roughVal}, ${roughVal})`;
    this.roughnessCtx.lineWidth = radius * 2;
    this.roughnessCtx.lineCap = 'round';
    this.roughnessCtx.lineJoin = 'round';
    this.roughnessCtx.beginPath();
    this.roughnessCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) this.roughnessCtx.lineTo(points[i].x, points[i].y);
    this.roughnessCtx.stroke();

    const metalVal = Math.floor(metalness * 255);
    this.metalnessCtx.strokeStyle = `rgb(${metalVal}, ${metalVal}, ${metalVal})`;
    this.metalnessCtx.lineWidth = radius * 2;
    this.metalnessCtx.lineCap = 'round';
    this.metalnessCtx.lineJoin = 'round';
    this.metalnessCtx.beginPath();
    this.metalnessCtx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) this.metalnessCtx.lineTo(points[i].x, points[i].y);
    this.metalnessCtx.stroke();

    const steps = 12;

    // 2. Draw segments with linear gradients (Height Only)
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;

      const nx = -dy / len;
      const ny = dx / len;

      const grad = this.ctx.createLinearGradient(
        p1.x + nx * radius,
        p1.y + ny * radius,
        p1.x - nx * radius,
        p1.y - ny * radius,
      );

      for (let s = 0; s <= steps; s++) {
        const t = (s / steps) * 2 - 1;
        const h = Math.sqrt(1 - t * t);
        const val = Math.floor(Math.min(255, baseHeight + h * heightScale));
        grad.addColorStop(s / steps, `rgb(${val}, ${val}, ${val})`);
      }

      this.ctx.strokeStyle = grad;
      this.ctx.lineWidth = radius * 2;
      this.ctx.lineCap = 'butt';
      this.ctx.lineJoin = 'miter';
      this.ctx.beginPath();
      this.ctx.moveTo(p1.x, p1.y);
      this.ctx.lineTo(p2.x, p2.y);
      this.ctx.stroke();
    }

    // 3. Draw joints/caps with radial gradients (Height Only)
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const rGrad = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const h = Math.sqrt(1 - t * t);
        const val = Math.floor(Math.min(255, baseHeight + h * heightScale));
        rGrad.addColorStop(t, `rgb(${val}, ${val}, ${val})`);
      }
      this.ctx.fillStyle = rGrad;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  private drawWireCap(x: number, y: number, radius: number, height: number) {
    // Shadow
    this.ctx.fillStyle = `rgb(${Math.max(0, height - 60)}, ${Math.max(0, height - 60)}, ${Math.max(0, height - 60)})`;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius + 2 * this.scale, 0, Math.PI * 2);
    this.ctx.fill();

    // Gradient Cap
    const rGrad = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
    const steps = 12;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const h = Math.sqrt(1 - t * t);
      const val = Math.floor(Math.min(255, height + h * 20));
      rGrad.addColorStop(t, `rgb(${val}, ${val}, ${val})`);
    }
    this.ctx.fillStyle = rGrad;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();

    // Inner hole
    this.ctx.fillStyle = `rgb(${Math.max(0, height - 80)}, ${Math.max(0, height - 80)}, ${Math.max(0, height - 80)})`;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius * 0.4, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private subdivide(x: number, y: number, w: number, h: number, depth: number) {
    const maxDepth = this.params.complexity;
    const minSize = 16 * this.scale;

    // Determine current size category based on the largest dimension
    const maxDim = Math.max(w, h);
    let currentTier: 'large' | 'medium' | 'small' = 'small';
    let stopProb = 0;

    if (maxDim > 400 * this.scale) {
      // Too big, force split so we don't end up with one giant panel covering the whole map
      currentTier = 'large';
      stopProb = 0;
    } else if (maxDim > 160 * this.scale) {
      currentTier = 'large';
      stopProb = this.params.largeDensity;
    } else if (maxDim > 64 * this.scale) {
      currentTier = 'medium';
      stopProb = this.params.mediumDensity;
    } else {
      currentTier = 'small';
      stopProb = this.params.smallDensity;
    }

    const mustStop = depth >= maxDepth || (w <= minSize * 2 && h <= minSize * 2);
    const shouldStop = mustStop || this.random() < stopProb;

    if (!shouldStop) {
      // Split
      const splitHorizontal = w > h ? false : h > w ? true : this.random() > 0.5;
      const gap = this.params.gapSize * this.scale;

      if (splitHorizontal && h > minSize * 2) {
        const splitY = this.randomRange(h * 0.3, h * 0.7);
        this.subdivide(x, y, w, splitY - gap / 2, depth + 1);
        this.subdivide(x, y + splitY + gap / 2, w, h - splitY - gap / 2, depth + 1);
      } else if (!splitHorizontal && w > minSize * 2) {
        const splitX = this.randomRange(w * 0.3, w * 0.7);
        this.subdivide(x, y, splitX - gap / 2, h, depth + 1);
        this.subdivide(x + splitX + gap / 2, y, w - splitX - gap / 2, h, depth + 1);
      } else {
        // Fallback if we can't split
        if (this.params.style === 'electrical') {
          this.drawElectricalPanel(x, y, w, h, currentTier);
        } else {
          this.drawPanel(x, y, w, h, currentTier);
        }
      }
    } else {
      // Stop and draw
      if (this.params.style === 'electrical') {
        this.drawElectricalPanel(x, y, w, h, currentTier);
      } else {
        this.drawPanel(x, y, w, h, currentTier);
      }
    }
  }

  private drawPanel(x: number, y: number, w: number, h: number, tier: 'large' | 'medium' | 'small') {
    // Determine height (grayscale value)
    // Spread the heights out significantly so different tiers have distinct depths
    let baseHeight = 0;
    if (tier === 'large') baseHeight = this.randomRange(100, 140); // Lowest base hull
    if (tier === 'medium') baseHeight = this.randomRange(150, 190); // Mid-level plating
    if (tier === 'small') baseHeight = this.randomRange(200, 250); // Highest raised details

    const color = Math.floor(baseHeight);

    // Determine corner style
    const cornerType: 'step' | 'chamfer' = this.random() < 0.5 ? 'step' : 'chamfer';
    const cornerSize = Math.floor(Math.min(w, h) * this.randomRange(0.1, 0.25));
    const hasCorners = this.random() < 0.6 && w > 32 * this.scale && h > 32 * this.scale;
    const corners: PanelShape['corners'] = [
      hasCorners && this.random() < 0.5, // TL
      hasCorners && this.random() < 0.5, // TR
      hasCorners && this.random() < 0.5, // BR
      hasCorners && this.random() < 0.5, // BL
    ];

    const bevel = (tier === 'large' ? 4 : tier === 'medium' ? 2 : 1) * this.scale;

    // Outer shadow/bevel (darker)
    this.ctx.fillStyle = `rgb(${Math.max(0, color - 60)}, ${Math.max(0, color - 60)}, ${Math.max(0, color - 60)})`;
    this.drawPanelShape(x, y, w, h, hasCorners ? cornerSize : 0, corners, cornerType);
    this.ctx.fill();

    // Inner main (lighter)
    this.ctx.fillStyle = `rgb(${color}, ${color}, ${color})`;
    this.drawPanelShape(
      x + bevel,
      y + bevel,
      w - bevel * 2,
      h - bevel * 2,
      hasCorners ? Math.max(0, cornerSize - bevel) : 0,
      corners,
      cornerType,
    );
    this.ctx.fill();

    const parentShape: PanelShape = { x, y, w, h, cornerSize: hasCorners ? cornerSize : 0, corners };

    // Clip to inner shape for cohesive sub-panels
    this.ctx.save();
    this.drawPanelShape(
      x + bevel,
      y + bevel,
      w - bevel * 2,
      h - bevel * 2,
      hasCorners ? Math.max(0, cornerSize - bevel) : 0,
      corners,
      cornerType,
    );
    this.ctx.clip();

    // Recursively draw sub-panels inside this shape
    this.drawSubPanels(x + bevel, y + bevel, w - bevel * 2, h - bevel * 2, color, 0, tier, parentShape);

    // Edge Notches
    this.drawEdgeNotches(x + bevel, y + bevel, w - bevel * 2, h - bevel * 2, color, parentShape);

    // Rivets/Bolts
    if (tier !== 'small' && this.random() < 0.8) {
      this.drawBolts(x + bevel, y + bevel, w - bevel * 2, h - bevel * 2, color, parentShape);
    }

    this.ctx.restore();
  }

  private intersectsCutCorner(dx: number, dy: number, dw: number, dh: number, parentShape?: PanelShape) {
    if (!parentShape || parentShape.cornerSize <= 0) return false;

    const { x: px, y: py, w: pw, h: ph, cornerSize: cs, corners } = parentShape;

    const checkOverlap = (
      r1x: number,
      r1y: number,
      r1w: number,
      r1h: number,
      r2x: number,
      r2y: number,
      r2w: number,
      r2h: number,
    ) => {
      return r1x < r2x + r2w && r1x + r1w > r2x && r1y < r2y + r2h && r1y + r1h > r2y;
    };

    if (corners[0] && checkOverlap(dx, dy, dw, dh, px, py, cs, cs)) return true;
    if (corners[1] && checkOverlap(dx, dy, dw, dh, px + pw - cs, py, cs, cs)) return true;
    if (corners[2] && checkOverlap(dx, dy, dw, dh, px + pw - cs, py + ph - cs, cs, cs)) return true;
    if (corners[3] && checkOverlap(dx, dy, dw, dh, px, py + ph - cs, cs, cs)) return true;

    return false;
  }

  private drawSubPanels(
    x: number,
    y: number,
    w: number,
    h: number,
    baseColor: number,
    depth: number,
    tier: PanelTier,
    parentShape: PanelShape,
  ) {
    const maxDepth = tier === 'large' ? 4 : tier === 'medium' ? 2 : 0;
    const minSize = 24 * this.scale;

    if (depth < maxDepth && w > minSize * 2 && h > minSize * 2 && this.random() < 0.8) {
      const isHorizontal = w > h ? false : h > w ? true : this.random() > 0.5;
      const split = isHorizontal ? this.randomRange(h * 0.3, h * 0.7) : this.randomRange(w * 0.3, w * 0.7);
      const lineThickness = this.randomRange(2 * this.scale, 4 * this.scale);

      if (isHorizontal) {
        this.drawSubPanels(x, y, w, split - lineThickness / 2, baseColor, depth + 1, tier, parentShape);
        this.drawSubPanels(
          x,
          y + split + lineThickness / 2,
          w,
          h - split - lineThickness / 2,
          baseColor,
          depth + 1,
          tier,
          parentShape,
        );

        // Draw panel line (cut)
        this.ctx.fillStyle = `rgb(${Math.max(0, baseColor - 50)}, ${Math.max(0, baseColor - 50)}, ${Math.max(0, baseColor - 50)})`;
        this.ctx.fillRect(x, y + split - lineThickness / 2, w, lineThickness);
      } else {
        this.drawSubPanels(x, y, split - lineThickness / 2, h, baseColor, depth + 1, tier, parentShape);
        this.drawSubPanels(
          x + split + lineThickness / 2,
          y,
          w - split - lineThickness / 2,
          h,
          baseColor,
          depth + 1,
          tier,
          parentShape,
        );

        // Draw panel line (cut)
        this.ctx.fillStyle = `rgb(${Math.max(0, baseColor - 50)}, ${Math.max(0, baseColor - 50)}, ${Math.max(0, baseColor - 50)})`;
        this.ctx.fillRect(x + split - lineThickness / 2, y, lineThickness, h);
      }
    } else {
      // Fill sub-panel with slight color variation to create distinct depth steps
      const subColor = Math.floor(Math.min(255, Math.max(60, baseColor + this.randomRange(-30, 30))));
      this.ctx.fillStyle = `rgb(${subColor}, ${subColor}, ${subColor})`;
      this.ctx.fillRect(x, y, w, h);

      // Decide what to put in this sub-panel
      const r = this.random();
      if (r < 0.3) {
        // Deep inset
        const insetMargin = this.randomRange(4 * this.scale, 12 * this.scale);
        if (w > insetMargin * 2 + 12 * this.scale && h > insetMargin * 2 + 12 * this.scale) {
          const ix = x + insetMargin;
          const iy = y + insetMargin;
          const iw = w - insetMargin * 2;
          const ih = h - insetMargin * 2;

          if (!this.intersectsCutCorner(ix, iy, iw, ih, parentShape)) {
            const insetColor = Math.max(0, subColor - 40);
            this.ctx.fillStyle = `rgb(${insetColor}, ${insetColor}, ${insetColor})`;
            this.ctx.fillRect(ix, iy, iw, ih);
            this.drawDetail(
              ix + 4 * this.scale,
              iy + 4 * this.scale,
              iw - 8 * this.scale,
              ih - 8 * this.scale,
              insetColor,
            );
          }
        }
      } else if (r < 0.85) {
        // Surface detail
        const margin = 6 * this.scale;
        if (w > margin * 2 + 8 * this.scale && h > margin * 2 + 8 * this.scale) {
          const dx = x + margin;
          const dy = y + margin;
          const dw = w - margin * 2;
          const dh = h - margin * 2;

          if (!this.intersectsCutCorner(dx, dy, dw, dh, parentShape)) {
            this.drawDetail(dx, dy, dw, dh, subColor);
          }
        }
      }
    }
  }

  private drawEdgeNotches(x: number, y: number, w: number, h: number, baseColor: number, parentShape: PanelShape) {
    if (w < 64 * this.scale || h < 64 * this.scale || this.random() > 0.7) return;

    this.ctx.fillStyle = `rgb(${Math.max(0, baseColor - 60)}, ${Math.max(0, baseColor - 60)}, ${Math.max(0, baseColor - 60)})`; // Deep cut
    const notchW = this.randomRange(12 * this.scale, 32 * this.scale);
    const notchH = this.randomRange(4 * this.scale, 8 * this.scale);

    let nx = 0,
      ny = 0,
      nw = 0,
      nh = 0;
    if (this.random() < 0.5) {
      nx = x + this.randomRange(24 * this.scale, w - notchW - 24 * this.scale);
      nw = notchW;
      nh = notchH;
      if (this.random() < 0.5) ny = y;
      else ny = y + h - notchH;
    } else {
      ny = y + this.randomRange(24 * this.scale, h - notchW - 24 * this.scale);
      nw = notchH;
      nh = notchW;
      if (this.random() < 0.5) nx = x;
      else nx = x + w - notchH;
    }

    if (!this.intersectsCutCorner(nx, ny, nw, nh, parentShape)) {
      this.ctx.fillRect(nx, ny, nw, nh);
    }
  }

  private drawDetail(x: number, y: number, w: number, h: number, baseColor: number) {
    if (w < 8 * this.scale || h < 8 * this.scale) return;
    const detailType = this.random();
    if (detailType < 0.25) {
      this.drawVents(x, y, w, h, baseColor);
    } else if (detailType < 0.45) {
      this.drawPipe(x, y, w, h, baseColor);
    } else if (detailType < 0.65) {
      this.drawTechNodes(x, y, w, h, baseColor);
    } else if (detailType < 0.8) {
      this.drawPerforatedGrid(x, y, w, h, baseColor);
    } else if (detailType < 0.9) {
      this.drawConcentricCircles(x + w / 2, y + h / 2, Math.min(w, h) / 2, baseColor);
    } else {
      this.drawPillSlots(x, y, w, h, baseColor);
    }
  }

  private drawPanelShape(
    x: number,
    y: number,
    w: number,
    h: number,
    size: number,
    corners: PanelShape['corners'],
    type: 'step' | 'chamfer',
  ) {
    this.ctx.beginPath();

    // Top Left
    if (corners[0] && size > 0) {
      this.ctx.moveTo(x, y + size);
      if (type === 'step') {
        this.ctx.lineTo(x + size, y + size);
        this.ctx.lineTo(x + size, y);
      } else {
        this.ctx.lineTo(x + size, y);
      }
    } else {
      this.ctx.moveTo(x, y);
    }

    // Top Right
    if (corners[1] && size > 0) {
      this.ctx.lineTo(x + w - size, y);
      if (type === 'step') {
        this.ctx.lineTo(x + w - size, y + size);
        this.ctx.lineTo(x + w, y + size);
      } else {
        this.ctx.lineTo(x + w, y + size);
      }
    } else {
      this.ctx.lineTo(x + w, y);
    }

    // Bottom Right
    if (corners[2] && size > 0) {
      this.ctx.lineTo(x + w, y + h - size);
      if (type === 'step') {
        this.ctx.lineTo(x + w - size, y + h - size);
        this.ctx.lineTo(x + w - size, y + h);
      } else {
        this.ctx.lineTo(x + w - size, y + h);
      }
    } else {
      this.ctx.lineTo(x + w, y + h);
    }

    // Bottom Left
    if (corners[3] && size > 0) {
      this.ctx.lineTo(x + size, y + h);
      if (type === 'step') {
        this.ctx.lineTo(x + size, y + h - size);
        this.ctx.lineTo(x, y + h - size);
      } else {
        this.ctx.lineTo(x, y + h - size);
      }
    } else {
      this.ctx.lineTo(x, y + h);
    }

    this.ctx.closePath();
  }

  private drawPerforatedGrid(x: number, y: number, w: number, h: number, baseColor: number) {
    this.ctx.fillStyle = `rgb(${Math.max(0, baseColor - 15)}, ${Math.max(0, baseColor - 15)}, ${Math.max(0, baseColor - 15)})`;
    this.ctx.fillRect(x, y, w, h);

    this.ctx.fillStyle = `rgb(${Math.max(0, baseColor - 50)}, ${Math.max(0, baseColor - 50)}, ${Math.max(0, baseColor - 50)})`;
    const dotSize = Math.max(1, 2 * this.scale);
    const spacing = 6 * this.scale;

    for (let py = y + spacing; py < y + h - spacing; py += spacing) {
      for (let px = x + spacing; px < x + w - spacing; px += spacing) {
        this.ctx.fillRect(px, py, dotSize, dotSize);
      }
    }
  }

  private drawConcentricCircles(cx: number, cy: number, radius: number, baseColor: number) {
    if (radius < 8 * this.scale) return;

    const steps = this.randomInt(2, 4);
    const stepSize = radius / steps;

    for (let i = 0; i < steps; i++) {
      const r = radius - i * stepSize;
      const isDark = i % 2 === 1;

      this.ctx.fillStyle = isDark
        ? `rgb(${Math.max(0, baseColor - 30)}, ${Math.max(0, baseColor - 30)}, ${Math.max(0, baseColor - 30)})`
        : `rgb(${Math.min(255, baseColor + 10)}, ${Math.min(255, baseColor + 10)}, ${Math.min(255, baseColor + 10)})`;

      this.ctx.beginPath();
      this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Center hole
    this.ctx.fillStyle = `rgb(${Math.max(0, baseColor - 60)}, ${Math.max(0, baseColor - 60)}, ${Math.max(0, baseColor - 60)})`;
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, stepSize * 0.5, 0, Math.PI * 2);
    this.ctx.fill();
  }

  private drawPillSlots(x: number, y: number, w: number, h: number, baseColor: number) {
    const isHorizontal = w > h;
    const slotCount = this.randomInt(2, 5);

    this.ctx.fillStyle = `rgb(${Math.max(0, baseColor - 40)}, ${Math.max(0, baseColor - 40)}, ${Math.max(0, baseColor - 40)})`;

    if (isHorizontal) {
      const slotW = (w - (slotCount + 1) * 8 * this.scale) / slotCount;
      const slotH = h * 0.6;
      const sy = y + (h - slotH) / 2;

      if (slotW > 4 * this.scale) {
        for (let i = 0; i < slotCount; i++) {
          const sx = x + 8 * this.scale + i * (slotW + 8 * this.scale);
          this.ctx.fillRect(sx, sy, slotW, slotH);
        }
      }
    } else {
      const slotH = (h - (slotCount + 1) * 8 * this.scale) / slotCount;
      const slotW = w * 0.6;
      const sx = x + (w - slotW) / 2;

      if (slotH > 4 * this.scale) {
        for (let i = 0; i < slotCount; i++) {
          const sy = y + 8 * this.scale + i * (slotH + 8 * this.scale);
          this.ctx.fillRect(sx, sy, slotW, slotH);
        }
      }
    }
  }

  private drawTechNodes(x: number, y: number, w: number, h: number, baseColor: number) {
    if (w < 16 * this.scale || h < 16 * this.scale) return;
    const nodeSize = Math.min(w, h) * 0.3;
    const count = this.randomInt(1, 3);

    this.ctx.fillStyle = `rgb(${Math.max(0, baseColor - 30)}, ${Math.max(0, baseColor - 30)}, ${Math.max(0, baseColor - 30)})`;

    for (let i = 0; i < count; i++) {
      const nx = x + this.randomRange(0, w - nodeSize);
      const ny = y + this.randomRange(0, h - nodeSize);

      if (this.random() < 0.5) {
        this.ctx.fillRect(nx, ny, nodeSize, nodeSize);
      } else {
        this.ctx.beginPath();
        this.ctx.arc(nx + nodeSize / 2, ny + nodeSize / 2, nodeSize / 2, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  private drawVents(x: number, y: number, w: number, h: number, baseColor: number) {
    const isHorizontal = w > h;
    const ventSpacing = Math.max(4 * this.scale, Math.min(w, h) / 8);
    const ventWidth = Math.max(2 * this.scale, ventSpacing * 0.6);

    this.ctx.fillStyle = `rgb(${Math.max(0, baseColor - 30)}, ${Math.max(0, baseColor - 30)}, ${Math.max(0, baseColor - 30)})`;
    this.ctx.fillRect(x, y, w, h); // Dark background for vents

    this.ctx.fillStyle = `rgb(${Math.min(255, baseColor + 20)}, ${Math.min(255, baseColor + 20)}, ${Math.min(255, baseColor + 20)})`;

    if (isHorizontal) {
      for (let i = x + ventSpacing; i < x + w - ventSpacing; i += ventSpacing) {
        this.ctx.fillRect(i, y + 4 * this.scale, ventWidth, h - 8 * this.scale);
      }
    } else {
      for (let i = y + ventSpacing; i < y + h - ventSpacing; i += ventSpacing) {
        this.ctx.fillRect(x + 4 * this.scale, i, w - 8 * this.scale, ventWidth);
      }
    }
  }

  private drawPipe(x: number, y: number, w: number, h: number, baseColor: number) {
    // Draw a cylindrical pipe with joints
    const isHorizontal = w > h;
    const pipeRadius = Math.min(w, h) / 4;

    if (pipeRadius < 2 * this.scale) return;

    const cx = x + w / 2;
    const cy = y + h / 2;

    // Pipe body
    let grad: CanvasGradient;
    if (isHorizontal) {
      grad = this.ctx.createLinearGradient(0, cy - pipeRadius, 0, cy + pipeRadius);
    } else {
      grad = this.ctx.createLinearGradient(cx - pipeRadius, 0, cx + pipeRadius, 0);
    }

    grad.addColorStop(
      0,
      `rgb(${Math.max(0, baseColor - 50)}, ${Math.max(0, baseColor - 50)}, ${Math.max(0, baseColor - 50)})`,
    );
    grad.addColorStop(
      0.2,
      `rgb(${Math.max(0, baseColor - 10)}, ${Math.max(0, baseColor - 10)}, ${Math.max(0, baseColor - 10)})`,
    );
    grad.addColorStop(
      0.5,
      `rgb(${Math.min(255, baseColor + 30)}, ${Math.min(255, baseColor + 30)}, ${Math.min(255, baseColor + 30)})`,
    );
    grad.addColorStop(
      0.8,
      `rgb(${Math.max(0, baseColor - 10)}, ${Math.max(0, baseColor - 10)}, ${Math.max(0, baseColor - 10)})`,
    );
    grad.addColorStop(
      1,
      `rgb(${Math.max(0, baseColor - 50)}, ${Math.max(0, baseColor - 50)}, ${Math.max(0, baseColor - 50)})`,
    );

    this.ctx.fillStyle = grad;

    if (isHorizontal) {
      this.ctx.fillRect(x, cy - pipeRadius, w, pipeRadius * 2);
    } else {
      this.ctx.fillRect(cx - pipeRadius, y, pipeRadius * 2, h);
    }

    // Pipe joints
    this.ctx.fillStyle = `rgb(${Math.max(0, baseColor - 40)}, ${Math.max(0, baseColor - 40)}, ${Math.max(0, baseColor - 40)})`;
    const jointWidth = pipeRadius * 1.5;
    const jointRadius = pipeRadius * 1.2;

    if (isHorizontal) {
      this.ctx.fillRect(x + w * 0.2, cy - jointRadius, jointWidth, jointRadius * 2);
      this.ctx.fillRect(x + w * 0.8 - jointWidth, cy - jointRadius, jointWidth, jointRadius * 2);
    } else {
      this.ctx.fillRect(cx - jointRadius, y + h * 0.2, jointRadius * 2, jointWidth);
      this.ctx.fillRect(cx - jointRadius, y + h * 0.8 - jointWidth, jointRadius * 2, jointWidth);
    }
  }

  private drawBolts(x: number, y: number, w: number, h: number, baseColor: number, parentShape?: PanelShape) {
    const boltRadius = 2 * this.scale;
    if (w < 16 * this.scale || h < 16 * this.scale) return;

    this.ctx.fillStyle = `rgb(${Math.min(255, baseColor + 40)}, ${Math.min(255, baseColor + 40)}, ${Math.min(255, baseColor + 40)})`;

    const positions = [
      [x + 4 * this.scale, y + 4 * this.scale],
      [x + w - 4 * this.scale, y + 4 * this.scale],
      [x + 4 * this.scale, y + h - 4 * this.scale],
      [x + w - 4 * this.scale, y + h - 4 * this.scale],
    ];

    for (const [bx, by] of positions) {
      if (
        parentShape &&
        this.intersectsCutCorner(bx - boltRadius, by - boltRadius, boltRadius * 2, boltRadius * 2, parentShape)
      ) {
        continue;
      }

      this.ctx.beginPath();
      this.ctx.arc(bx, by, boltRadius, 0, Math.PI * 2);
      this.ctx.fill();

      // Bolt shadow/hole
      this.ctx.fillStyle = `rgb(20, 20, 20)`;
      this.ctx.beginPath();
      this.ctx.arc(bx, by, boltRadius * 0.5, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.fillStyle = `rgb(${Math.min(255, baseColor + 40)}, ${Math.min(255, baseColor + 40)}, ${Math.min(255, baseColor + 40)})`;
    }
  }
}
