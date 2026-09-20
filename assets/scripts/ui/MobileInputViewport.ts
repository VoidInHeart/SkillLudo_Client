/** Keep Cocos' CSS frame stable while a mobile browser animates its keyboard.
 * Only move the frame enough to expose the focused field; never blur/refocus it. */
export class MobileInputViewport {
  private readonly frame = document.getElementById('GameDiv');
  private readonly style: HTMLStyleElement;
  private active: HTMLInputElement | HTMLTextAreaElement | null = null;
  private locked = false;
  private layoutWidth = 0;
  private shift = 0;
  private shiftX = 0;
  private raf = 0;
  private releaseTimer: ReturnType<typeof setTimeout> | undefined;

  public constructor(private readonly settled: () => void) {
    this.style = document.createElement('style'); this.style.id = 'SkillLudoMobileInputViewport';
    // Higher specificity than both the web template and engine inline geometry.
    // Custom properties survive the engine writing frame.style.height on resize.
    this.style.textContent = '#GameDiv[data-mobile-editing="true"] { width:var(--ludo-edit-width) !important; height:var(--ludo-edit-height) !important; top:var(--ludo-edit-top,0px) !important; bottom:auto !important; left:var(--ludo-edit-left,0px) !important; right:auto !important; margin:0 !important; transform:none !important; }';
    document.head.appendChild(this.style);
    document.addEventListener('focusin', this.onFocus, true);
    document.addEventListener('focusout', this.onBlur, true);
    window.addEventListener('resize', this.onViewport);
    window.visualViewport?.addEventListener('resize', this.onViewport);
    window.visualViewport?.addEventListener('scroll', this.onViewport);
  }
  public destroy(): void {
    document.removeEventListener('focusin', this.onFocus, true); document.removeEventListener('focusout', this.onBlur, true);
    window.removeEventListener('resize', this.onViewport);
    window.visualViewport?.removeEventListener('resize', this.onViewport); window.visualViewport?.removeEventListener('scroll', this.onViewport);
    clearTimeout(this.releaseTimer); cancelAnimationFrame(this.raf); this.unlock(false); this.style.remove();
  }
  private input(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
    return target instanceof HTMLElement && target.matches('input.cocosEditBox, textarea.cocosEditBox');
  }
  private readonly onFocus = (event: FocusEvent): void => {
    if (!this.frame || !this.input(event.target)) return;
    clearTimeout(this.releaseTimer); this.active = event.target;
    if (!this.locked) {
      this.layoutWidth = window.innerWidth;
      const box = this.frame.getBoundingClientRect();
      this.frame.style.setProperty('--ludo-edit-width', `${box.width}px`);
      this.frame.style.setProperty('--ludo-edit-height', `${box.height}px`);
      this.frame.style.setProperty('--ludo-edit-top', '0px');
      this.frame.style.setProperty('--ludo-edit-left', '0px');
      this.frame.dataset.mobileEditing = 'true'; this.locked = true; this.shift = 0; this.shiftX = 0;
    }
    this.onViewport();
  };
  private readonly onBlur = (event: FocusEvent): void => {
    if (!this.input(event.target)) return;
    this.active = null; clearTimeout(this.releaseTimer);
    // Swapping fields produces blur then focus; keep the original geometry.
    // Let the keyboard's closing animation settle before reflowing the lobby.
    this.releaseTimer = setTimeout(() => {
      if (!this.input(document.activeElement)) this.unlock(true);
    }, 450);
  };
  private readonly onViewport = (): void => {
    // Keyboard/candidate rows change height; a new layout width means a real
    // rotation or window resize. Finish editing once and allow the new layout.
    // Do not restore focus here: that would reopen the keyboard during reflow.
    if (this.locked && Math.abs(window.innerWidth - this.layoutWidth) > 1) {
      this.active?.blur(); clearTimeout(this.releaseTimer); this.unlock(true); return;
    }
    this.exposeInput();
    if (!this.raf && this.locked && this.active) this.raf = requestAnimationFrame(this.trackInput);
  };
  private readonly trackInput = (): void => {
    this.raf = 0;
    // Cocos updates the DOM transform in beforeDraw, after resize listeners.
    // Follow that settled geometry as the keyboard/IME animates; write only
    // when the required offset changes, and stop tracking when editing ends.
    this.exposeInput();
    if (this.locked && this.active) this.raf = requestAnimationFrame(this.trackInput);
  };
  private exposeInput(): void {
    if (!this.locked || !this.active || document.activeElement !== this.active || !this.frame) return;
    const viewport = window.visualViewport;
    const top = (viewport?.offsetTop ?? 0) + 12;
    const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 12;
    const rect = this.active.getBoundingClientRect();
    const shift = Math.min(0, Math.max(top - (rect.top - this.shift), bottom - (rect.bottom - this.shift)));
    if (Math.abs(shift - this.shift) > .5) { this.shift = shift; this.frame.style.setProperty('--ludo-edit-top', `${shift}px`); }
    const left = (viewport?.offsetLeft ?? 0) + 12, right = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - 12;
    const shiftX = Math.min(0, Math.max(left - (rect.left - this.shiftX), right - (rect.right - this.shiftX)));
    if (Math.abs(shiftX - this.shiftX) > .5) { this.shiftX = shiftX; this.frame.style.setProperty('--ludo-edit-left', `${shiftX}px`); }
  }
  private unlock(notify: boolean): void {
    if (!this.locked) return;
    this.locked = false; this.shift = 0; this.shiftX = 0; this.active = null; cancelAnimationFrame(this.raf); this.raf = 0;
    this.frame?.removeAttribute('data-mobile-editing');
    for (const property of ['--ludo-edit-width', '--ludo-edit-height', '--ludo-edit-top', '--ludo-edit-left']) this.frame?.style.removeProperty(property);
    if (notify) { window.dispatchEvent(new Event('resize')); this.settled(); }
  }
}
