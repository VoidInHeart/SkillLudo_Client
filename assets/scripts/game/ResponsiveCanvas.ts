import { ResolutionPolicy, screen, Size, sys, view } from 'cc';
import { MobileInputViewport } from '../ui/MobileInputViewport';

/** Keep the render buffer and input coordinates in the same aspect ratio.
 * Landscape uses 720 units of height; portrait uses 720 units of width. */
export class ResponsiveCanvas {
  private readonly mobileInput: MobileInputViewport | null;
  private frame: HTMLElement | null = null;
  private frameObserver: ResizeObserver | null = null;
  private width = 0;
  private height = 0;
  public constructor() {
    this.mobileInput = sys.isBrowser && sys.isMobile ? new MobileInputViewport(() => this.resize()) : null;
    view.resizeWithBrowserSize(true);
    screen.on('window-resize', this.resize, this);
    this.resize();
    if (sys.isBrowser && document.getElementById('GameDiv')?.getAttribute('cc_exact_fit_screen') === 'false') {
      this.frame = document.getElementById('GameDiv');
      window.addEventListener('resize', this.syncFrame);
      if (typeof ResizeObserver !== 'undefined') {
        this.frameObserver = new ResizeObserver(this.syncFrame);
        this.frameObserver.observe(this.frame!);
      }
    }
  }
  public destroy(): void {
    screen.off('window-resize', this.resize, this); this.mobileInput?.destroy(); this.frameObserver?.disconnect();
    if (this.frame) window.removeEventListener('resize', this.syncFrame);
  }
  private readonly syncFrame = (): void => {
    if (!this.frame) return;
    const width = this.frame.clientWidth * screen.devicePixelRatio, height = this.frame.clientHeight * screen.devicePixelRatio;
    // The engine's subframe mode watches inline sizes, not computed CSS sizes.
    // Set the public window size only on actual CSS changes, including unlock.
    if (width !== this.width || height !== this.height) screen.windowSize = new Size(width, height);
  };
  private resize(): void {
    const size = screen.windowSize;
    if (size.width === this.width && size.height === this.height) return;
    this.width = size.width; this.height = size.height;
    const portrait = size.height > size.width;
    view.setDesignResolutionSize(portrait ? 720 : 1280, portrait ? 1280 : 720, portrait ? ResolutionPolicy.FIXED_WIDTH : ResolutionPolicy.FIXED_HEIGHT);
  }
}
