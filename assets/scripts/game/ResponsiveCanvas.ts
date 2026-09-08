import { ResolutionPolicy, screen, view } from 'cc';

/** Keep the render buffer and input coordinates in the same aspect ratio.
 * Landscape uses 720 units of height; portrait uses 720 units of width. */
export class ResponsiveCanvas {
  public constructor() {
    view.resizeWithBrowserSize(true);
    screen.on('window-resize', this.resize, this);
    this.resize();
  }
  public destroy(): void { screen.off('window-resize', this.resize, this); }
  private resize(): void {
    const size = screen.windowSize;
    const portrait = size.height > size.width;
    view.setDesignResolutionSize(portrait ? 720 : 1280, portrait ? 1280 : 720, portrait ? ResolutionPolicy.FIXED_WIDTH : ResolutionPolicy.FIXED_HEIGHT);
  }
}
