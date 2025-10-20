import Link from "next/link";

import { Logo } from "~/app/components/icons";

export default function Footer() {
  return (
    <footer className="flex w-full flex-row px-4 py-10 sm:px-6 sm:py-6 md:px-8 md:py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-row items-center justify-center">
        <div className="flex flex-row items-center justify-center gap-2 text-muted-foreground">
          <Logo className="h-6 w-6" aria-hidden="true" />
          <span className="text-sm font-semibold">whisp</span>
          <span className="text-muted-foreground">•</span>
          <Link
            href="/terms"
            className="text-xs underline underline-offset-2 md:text-sm"
          >
            Terms
          </Link>
          <Link
            href="/privacy"
            className="text-xs underline underline-offset-2 md:text-sm"
          >
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
