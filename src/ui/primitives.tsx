import {
  Button as AriaButton,
  Checkbox as AriaCheckbox,
  Dialog as AriaDialog,
  Modal,
  ModalOverlay,
  type ButtonProps,
  type CheckboxProps,
  type DialogProps,
} from "react-aria-components";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

export type ControlVariant = "primary" | "secondary" | "quiet" | "danger";

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonProps & { variant?: ControlVariant }) {
  return (
    <AriaButton
      {...props}
      className={({ isPressed, isDisabled, isFocusVisible }) =>
        [
          "button",
          variant,
          isPressed && "is-pressed",
          isDisabled && "is-disabled",
          isFocusVisible && "is-focus-visible",
          typeof className === "string" ? className : "",
        ]
          .filter(Boolean)
          .join(" ")
      }
    />
  );
}

export function Checkbox({
  children,
  className = "",
  ...props
}: CheckboxProps & { children: ReactNode }) {
  return (
    <AriaCheckbox
      {...props}
      className={({ isSelected, isDisabled, isFocusVisible }) =>
        [
          "aria-checkbox",
          isSelected && "is-selected",
          isDisabled && "is-disabled",
          isFocusVisible && "is-focus-visible",
          typeof className === "string" ? className : "",
        ]
          .filter(Boolean)
          .join(" ")
      }
    >
      {({ isSelected }) => (
        <>
          <span className="aria-checkbox-control" aria-hidden="true">
            {isSelected && <Check size={13} strokeWidth={2.5} />}
          </span>
          <span className="aria-checkbox-copy">{children}</span>
        </>
      )}
    </AriaCheckbox>
  );
}

export function Dialog({
  isOpen,
  onOpenChange,
  children,
  className = "",
  ...props
}: DialogProps & {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <ModalOverlay
      className="dialog-overlay"
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      isDismissable
    >
      <Modal className={`dialog-modal ${className}`}>
        <AriaDialog {...props} className="dialog-content">
          {children}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
