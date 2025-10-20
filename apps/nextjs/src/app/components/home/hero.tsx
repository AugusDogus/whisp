import type { Variants } from "motion/react";
import Image from "next/image";

import { AnimatedGroup } from "@acme/ui/animated-group";

import Footer from "~/app/components/home/footer";
import Header from "~/app/components/home/header";
import { WaitlistForm } from "~/app/components/home/waitlist";

const transitionVariants: { item: Variants } = {
  item: {
    hidden: {
      opacity: 0,
      y: 12,
    },
    visible: {
      opacity: 1,
      filter: "blur(0px)",
      y: 0,
      transition: {
        type: "spring",
        bounce: 0.3,
        duration: 1.5,
      },
    },
  },
};

export default function Hero() {
  return (
    <div className="font-geist flex w-full flex-1 flex-col items-center justify-center gap-12 overflow-hidden px-4 py-40 md:gap-16">
      <Header />
      <AnimatedGroup variants={transitionVariants} className="w-full">
        <div className="relative flex w-full flex-col gap-12 px-4 md:px-6">
          <div className="relative mx-auto w-full max-w-3xl sm:max-w-4xl md:max-w-5xl lg:max-w-6xl">
            <div className="flex flex-col items-center justify-center gap-8 text-center md:gap-12 lg:gap-12">
              <h1 className="text-4xl leading-tight md:text-5xl">
                Ephemeral messaging <br /> that doesn't suck
              </h1>
              <p className="mx-auto max-w-xs text-pretty text-sm leading-tight sm:text-[16px]">
                Share moments that vanish.
                <br />
                Privacy-first photo and video messaging for your closest
                friends.
              </p>
            </div>
          </div>
          <WaitlistForm />
        </div>
      </AnimatedGroup>

      <AnimatedGroup
        variants={{
          container: {
            visible: {
              transition: {
                staggerChildren: 0.05,
                delayChildren: 0.25,
              },
            },
          },
          ...transitionVariants,
        }}
      >
        <div className="backdrop-blur-xs mx-auto w-full max-w-3xl rounded-xl border border-border bg-gray-50/5 p-2 sm:min-w-0 sm:max-w-4xl sm:translate-x-0">
          <Image
            src="/hero.jpg"
            alt="Hero"
            className="z-10 ml-0 block h-auto w-full rounded-lg object-cover sm:mx-auto"
            width={1200}
            height={800}
            unoptimized
            loading="lazy"
            sizes="(max-width: 768px) 100vw, 80vw"
          />
        </div>
      </AnimatedGroup>
      <Footer />
    </div>
  );
}
