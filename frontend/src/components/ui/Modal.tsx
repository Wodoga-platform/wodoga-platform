/**
 * Wodoga Platform — Modal Component
 * Accessible dialog using Radix UI primitives.
 */

'use client';

import { type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/utils';

interface ModalProps {
  open:        boolean;
  onClose:     () => void;
  title:       string;
  subtitle?:   string;
  children:    ReactNode;
  size?:       'sm' | 'md' | 'lg' | 'xl';
  footer?:     ReactNode;
}

const SIZE_CLASS = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
};

export function Modal({ open, onClose, title, subtitle, children, size = 'md', footer }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        {/* Backdrop */}
        <Dialog.Overlay className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50 animate-fade-in" />

        {/* Panel */}
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'bg-surface border border-surface-border rounded-xl shadow-xl',
            'w-[95vw] max-h-[88vh] overflow-y-auto',
            'animate-modal-in',
            SIZE_CLASS[size],
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between p-7 pb-0">
            <div>
              <Dialog.Title className="font-display text-xl font-semibold text-ink tracking-tight">
                {title}
              </Dialog.Title>
              {subtitle && (
                <Dialog.Description className="text-sm text-ink-3 mt-1">{subtitle}</Dialog.Description>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded border border-surface-border
                         text-ink-3 hover:bg-red-ghost hover:text-red hover:border-red-pale
                         transition-colors duration-150 flex-shrink-0 ml-4 mt-0.5"
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="p-7 pt-5">{children}</div>

          {/* Footer */}
          {footer && (
            <div className="px-7 pb-7 pt-0 border-t border-surface-border mt-2 pt-5">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Modal Footer Helper ───────────────────────────────────────
export function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-end gap-2.5', className)}>
      {children}
    </div>
  );
}
