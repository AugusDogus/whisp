import { useMemo } from "react";
import { Platform } from "react-native";
import {
  Group,
  Paragraph,
  RoundedRect,
  Skia,
  TextAlign,
} from "@shopify/react-native-skia";

import type { CaptionData } from "./caption-editor";

interface SkiaCaptionRendererProps {
  captions: CaptionData[];
  containerWidth: number;
  containerHeight: number;
  scale?: number; // Scale factor for thumbnail rendering
}

const BASE_FONT_SIZE = 16;
const BASE_PILL_PADDING_H = 12;
const BASE_PILL_PADDING_V = 6;
const PILL_BG_COLOR = "rgba(0, 0, 0, 0.6)";
const TEXT_COLOR = "#FFFFFF";

export function SkiaCaptionRenderer({
  captions,
  containerWidth,
  containerHeight,
  scale = 1,
}: SkiaCaptionRendererProps) {
  const FONT_SIZE = BASE_FONT_SIZE * scale;
  const PILL_PADDING_H = BASE_PILL_PADDING_H * scale;
  const PILL_PADDING_V = BASE_PILL_PADDING_V * scale;

  // Process each caption to get displayText and paragraph
  const processedCaptions = useMemo(() => {
    // Capture scaled values for use in the callback
    const fontSize = FONT_SIZE;
    const paddingH = PILL_PADDING_H;
    const paddingV = PILL_PADDING_V;

    return captions
      .filter((c) => c.text.length > 0)
      .map((caption) => {
        // Handle word wrapping
        const maxWidth = containerWidth - paddingH * 2;
        const words = caption.text.split(" ");
        const lines: string[] = [];
        let currentLine = "";

        const paragraphStyle = { textAlign: TextAlign.Left };
        const textStyle = {
          color: Skia.Color(TEXT_COLOR),
          fontSize,
          fontFamilies: [
            Platform.select({
              ios: "Helvetica Neue",
              android: "sans-serif",
              default: "sans-serif",
            }),
          ],
          fontStyle: { weight: 400 },
        };

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;

          // Use Paragraph API to measure the actual width
          const testParagraph = Skia.ParagraphBuilder.Make(paragraphStyle);
          testParagraph.pushStyle(textStyle);
          testParagraph.addText(testLine);
          testParagraph.pop();
          const p = testParagraph.build();
          p.layout(999999);
          const testWidth = p.getLongestLine();

          if (testWidth > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine) lines.push(currentLine);

        const displayText = lines.join("\n").replace(/ /g, "\u00A0");

        // Create paragraph for rendering
        const centerParagraphStyle = { textAlign: TextAlign.Center };
        const builder = Skia.ParagraphBuilder.Make(centerParagraphStyle);
        builder.pushStyle(textStyle);
        builder.addText(displayText);
        builder.pop();
        const paragraph = builder.build();
        paragraph.layout(containerWidth - paddingH * 2);

        // Calculate height
        const minHeight = fontSize * 1.2 + paddingV * 2;
        const barHeight = Math.max(
          minHeight,
          paragraph.getHeight() + paddingV * 2,
        );

        // Calculate Y position
        const yPos = caption.y * containerHeight;

        return {
          id: caption.id,
          paragraph,
          barHeight,
          yPos,
          paddingH,
          paddingV,
        };
      });
  }, [
    captions,
    containerWidth,
    containerHeight,
    FONT_SIZE,
    PILL_PADDING_H,
    PILL_PADDING_V,
  ]);

  return (
    <>
      {processedCaptions.map((processed) => (
        <Group key={processed.id}>
          <RoundedRect
            x={0}
            y={processed.yPos}
            width={containerWidth}
            height={processed.barHeight}
            r={0}
            color={PILL_BG_COLOR}
          />
          <Paragraph
            paragraph={processed.paragraph}
            x={processed.paddingH}
            y={processed.yPos + processed.paddingV}
            width={containerWidth - processed.paddingH * 2}
          />
        </Group>
      ))}
    </>
  );
}
