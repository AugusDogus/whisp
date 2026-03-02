import * as React from "react";
import type { Role } from "react-native";
import { Text as RNText } from "react-native";

import { cn } from "~/lib/utils";

type TextVariant =
  | "default"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "p"
  | "blockquote"
  | "code"
  | "lead"
  | "large"
  | "small"
  | "muted";

const VARIANT_CLASSES: Record<TextVariant, string> = {
  default: "",
  h1: "text-center text-4xl font-extrabold tracking-tight",
  h2: "border-b border-separator pb-2 text-3xl font-semibold tracking-tight",
  h3: "text-2xl font-semibold tracking-tight",
  h4: "text-xl font-semibold tracking-tight",
  p: "mt-3 leading-7",
  blockquote: "mt-4 border-l-2 pl-3 italic",
  code: "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold",
  lead: "text-xl text-muted",
  large: "text-lg font-semibold",
  small: "text-sm font-medium leading-none",
  muted: "text-sm text-muted",
};

const ROLE: Partial<Record<TextVariant, Role>> = {
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
};

const ARIA_LEVEL: Partial<Record<TextVariant, string>> = {
  h1: "1",
  h2: "2",
  h3: "3",
  h4: "4",
};

interface TextProps extends React.ComponentProps<typeof RNText> {
  variant?: TextVariant;
}

function Text({ className, variant = "default", ...props }: TextProps) {
  return (
    <RNText
      className={cn(
        "text-base text-foreground",
        VARIANT_CLASSES[variant],
        className,
      )}
      role={ROLE[variant]}
      aria-level={ARIA_LEVEL[variant]}
      {...props}
    />
  );
}

export { Text };
export type { TextVariant, TextProps };
