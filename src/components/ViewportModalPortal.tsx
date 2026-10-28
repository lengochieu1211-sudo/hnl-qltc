import type { PropsWithChildren } from 'react';
import { createPortal } from 'react-dom';

/** A modal inside a scrollable/blurred feature sheet must escape that containing block.
 * The React tree (callbacks, project context, state and role checks) is unchanged.
 * No extra DOM layer is inserted, preserving the modal's own focus/backdrop rules. */
export const ViewportModalPortal = ({ children }: PropsWithChildren) =>
  typeof document === 'undefined' ? <>{children}</> : createPortal(children, document.body);
