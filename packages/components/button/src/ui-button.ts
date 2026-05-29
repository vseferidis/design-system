import { LitElement, html, css, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { UIButtonVariant, UIButtonSize } from './types.js';

@customElement('ui-button')
export class UIButton extends LitElement {
  @property({ type: String, reflect: true }) variant: UIButtonVariant = 'primary';
  @property({ type: String, reflect: true }) size: UIButtonSize = 'md';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) loading = false;

  static styles = css`
    :host {
      display: inline-block;
      font-family: var(--font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
    }

    button {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-sm, 8px);
      border: 1px solid transparent;
      cursor: pointer;
      font-weight: var(--font-weight-medium, 500);
      transition: background var(--transition-fast, 120ms ease),
                  border-color var(--transition-fast, 120ms ease),
                  color var(--transition-fast, 120ms ease),
                  box-shadow var(--transition-fast, 120ms ease);
      white-space: nowrap;
      user-select: none;
      text-decoration: none;
    }

    button:focus-visible {
      outline: 2px solid var(--color-focus-ring, #93C5FD);
      outline-offset: 2px;
    }

    /* Sizes */
    :host([size='sm']) button {
      padding: var(--spacing-xs, 4px) var(--spacing-sm, 8px);
      font-size: var(--font-size-sm, 13px);
      border-radius: var(--radius-sm, 4px);
    }

    :host([size='md']) button {
      padding: var(--spacing-sm, 8px) var(--spacing-md, 12px);
      font-size: var(--font-size-md, 14px);
      border-radius: var(--radius-md, 6px);
    }

    :host([size='lg']) button {
      padding: var(--spacing-md, 12px) var(--spacing-lg, 16px);
      font-size: var(--font-size-lg, 16px);
      border-radius: var(--radius-lg, 8px);
    }

    /* Variants */
    :host([variant='primary']) button {
      background: var(--color-primary, #3B82F6);
      color: var(--color-text-inverse, #FFFFFF);
      box-shadow: var(--shadow-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05));
    }

    :host([variant='primary']) button:hover:not(:disabled) {
      background: var(--color-primary-hover, #2563EB);
    }

    :host([variant='primary']) button:active:not(:disabled) {
      background: var(--color-primary-active, #1D4ED8);
    }

    :host([variant='secondary']) button {
      background: var(--color-surface, #FFFFFF);
      color: var(--color-text, #111827);
      border-color: var(--color-border, #E5E7EB);
      box-shadow: var(--shadow-sm, 0 1px 2px 0 rgb(0 0 0 / 0.05));
    }

    :host([variant='secondary']) button:hover:not(:disabled) {
      background: var(--color-surface-subtle, #F9FAFB);
      border-color: var(--color-secondary-hover, #4B5563);
    }

    :host([variant='ghost']) button {
      background: transparent;
      color: var(--color-text, #111827);
    }

    :host([variant='ghost']) button:hover:not(:disabled) {
      background: var(--color-surface-subtle, #F9FAFB);
    }

    /* Disabled */
    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Loading */
    .spinner {
      display: none;
      width: 1em;
      height: 1em;
      border: 2px solid currentColor;
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    :host([loading]) .spinner {
      display: inline-block;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    slot[name='icon-left'],
    slot[name='icon-right'] {
      display: inline-flex;
      align-items: center;
    }
  `;

  render() {
    return html`
      <button
        ?disabled=${this.disabled || this.loading}
        aria-busy=${this.loading}
        part="button"
      >
        ${this.loading ? html`<span class="spinner" aria-hidden="true"></span>` : ''}
        <slot name="icon-left"></slot>
        <slot></slot>
        <slot name="icon-right"></slot>
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ui-button': UIButton;
  }
}
