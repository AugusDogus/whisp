"use client";

import React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

import { Discord, GitHub, Logo, Twitter } from "~/app/components/icons";
import { URLS } from "~/lib/urls";
import { cn } from "~/lib/utils";

const socialItems = [
  {
    label: "GitHub",
    href: URLS.GITHUB,
    icon: GitHub,
  },
  {
    label: "Twitter",
    href: URLS.TWITTER,
    icon: Twitter,
  },
  {
    label: "Discord",
    href: URLS.DISCORD,
    icon: Discord,
  },
];

export default function Header() {
  const [menuState, setMenuState] = React.useState(false);
  const [isScrolled, setIsScrolled] = React.useState(false);

  React.useEffect(() => {
    function handleScroll() {
      setIsScrolled(window.scrollY > 50);
    }
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header>
      <nav
        data-state={menuState && "active"}
        className="fixed left-0 right-0 top-0 z-20 w-full px-2 pt-4"
      >
        <div
          className={cn(
            "mx-auto max-w-6xl border-none px-6 transition-all duration-300 lg:px-12",
            isScrolled &&
              "max-w-4xl rounded-2xl border bg-background/50 backdrop-blur-lg dark:bg-white/5 lg:px-5",
          )}
        >
          <div className="relative flex flex-wrap items-center justify-between gap-6 py-3 lg:gap-0 lg:py-4">
            <div className="flex w-full justify-between lg:w-auto">
              <Link
                href="/"
                aria-label="home"
                className="flex items-center space-x-2 opacity-80 duration-150 hover:opacity-100"
              >
                <Logo className="h-6" />
                <span className="text-lg font-semibold">whisp</span>
              </Link>

              <button
                onClick={() => setMenuState(!menuState)}
                aria-label={menuState ? "Close Menu" : "Open Menu"}
                className="relative z-20 -m-2.5 -mr-4 block cursor-pointer p-2.5 lg:hidden"
              >
                <Menu className="in-data-[state=active]:scale-0 in-data-[state=active]:rotate-180 in-data-[state=active]:opacity-0 m-auto size-6 duration-200" />
                <X className="in-data-[state=active]:scale-100 in-data-[state=active]:rotate-0 in-data-[state=active]:opacity-100 absolute inset-0 m-auto size-6 -rotate-180 scale-0 opacity-0 duration-200" />
              </button>
            </div>

            <div className="in-data-[state=active]:block lg:in-data-[state=active]:flex mb-6 hidden w-full flex-wrap items-center justify-end space-y-8 rounded-3xl border bg-background p-6 shadow-2xl shadow-zinc-300/20 dark:shadow-none md:flex-nowrap lg:m-0 lg:flex lg:w-fit lg:gap-6 lg:space-y-0 lg:border-transparent lg:bg-transparent lg:p-0 lg:shadow-none dark:lg:bg-transparent">
              <div className="flex w-full flex-col space-y-6 sm:flex-row sm:gap-3 sm:space-y-0 md:w-fit">
                <div className="flex flex-row items-center justify-around gap-8 px-8 sm:pl-0">
                  {socialItems.map((item) => (
                    <a
                      className="size-4 rounded-full duration-150 hover:opacity-80"
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      key={item.label}
                    >
                      <item.icon className="fill-primary" />
                      <span className="sr-only">{item.label}</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
}
