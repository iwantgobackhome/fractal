import { useId, type JSX } from 'react';

/**
 * The News Papers mark: two stacked pages, N and P, the same artwork as the app and
 * menu-bar icons (apps/desktop/assets/brand/tray.svg). Drawn with the current text
 * colour so it sits in any theme.
 */
export function FractalMark({ size = 20 }: { size?: number }): JSX.Element {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="40" height="40">
          <rect width="40" height="40" fill="#fff" />
          <path
            transform="translate(5.2 7.2) scale(0.062)"
            fill="#000"
            fillRule="evenodd"
            d="M0 0H86L150 128V18H124V0H200V18H182V220H140L56 52V202H82V220H0V202H24V18H0Z"
          />
          <path
            transform="translate(19.3 17.6) scale(0.072)"
            fill="#000"
            fillRule="evenodd"
            d="M0 0H118C172 0 200 30 200 66C200 104 172 134 118 134H82V202H112V220H0V202H24V18H0ZM82 20V114H106C134 114 144 94 144 66C144 40 134 20 106 20Z"
          />
          <rect x="13.2" y="14.2" width="24.6" height="24.6" rx="4.6" fill="#000" />
          <rect x="15" y="16" width="21" height="21" rx="3.4" fill="#fff" />
          <path
            transform="translate(19.3 18.6) scale(0.072)"
            fill="#000"
            fillRule="evenodd"
            d="M0 0H118C172 0 200 30 200 66C200 104 172 134 118 134H82V202H112V220H0V202H24V18H0ZM82 20V114H106C134 114 144 94 144 66C144 40 134 20 106 20Z"
          />
        </mask>
      </defs>
      <g mask={`url(#${id})`} fill="currentColor">
        <rect x="2" y="3" width="21" height="27" rx="3.4" />
        <rect x="15" y="16" width="21" height="21" rx="3.4" />
      </g>
    </svg>
  );
}
