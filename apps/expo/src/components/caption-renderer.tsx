import { useMemo } from "react";
import { Platform, StyleSheet, View } from "react-native";
import {
  Canvas,
  Group,
  matchFont,
  RoundedRect,
  Text as SkiaText,
} from "@shopify/react-native-skia";

import type { Annotation } from "@acme/validators";

interface CaptionRendererProps {
  annotations?: string; // JSON string of Annotation[]
  containerWidth: number;
  containerHeight: number;
}

const FONT_SIZE = 24;
const PILL_PADDING_H = 12;
const PILL_PADDING_V = 6;
const PILL_BORDER_RADIUS = 16;
const PILL_BG_COLOR = "rgba(0, 0, 0, 0.6)";
const TEXT_COLOR = "#FFFFFF";
const MAX_TEXT_WIDTH_RATIO = 0.9;

export function CaptionRenderer({
  annotations,
  containerWidth,
  containerHeight,
}: CaptionRendererProps) {
  // Parse annotations from JSON string
  const parsedAnnotations = useMemo<Annotation[]>(() => {
    if (!annotations) return [];
    try {
      const parsed = JSON.parse(annotations) as Annotation[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [annotations]);

  // Use system font for Skia rendering - matches across platforms
  const font = useMemo(() => {
    const fontFamily = Platform.select({
      ios: "Helvetica Neue",
      android: "sans-serif",
      default: "sans-serif",
    });
    return matchFont({
      fontFamily,
      fontSize: FONT_SIZE,
      fontWeight: "bold",
    });
  }, []);

  // Calculate text metrics for each annotation
  const captionMetrics = useMemo(() => {
    if (!font || parsedAnnotations.length === 0) return [];

    return parsedAnnotations
      .filter((ann) => ann.text)
      .map((ann) => {
        const maxWidth = containerWidth * MAX_TEXT_WIDTH_RATIO;
        const lines: string[] = [];
        let currentLine = "";

        // Simple word wrapping
        const words = ann.text.split(" ");
        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const lineWidth = font.measureText(testLine).width;

          if (lineWidth > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }
        if (currentLine) lines.push(currentLine);

        // Calculate dimensions
        const lineHeight = FONT_SIZE * 1.2;
        const textWidth = Math.max(
          ...lines.map((line) => font.measureText(line).width),
        );
        const textHeight = lines.length * lineHeight;

        const pillWidth = textWidth + PILL_PADDING_H * 2;
        const pillHeight = textHeight + PILL_PADDING_V * 2;

        // Convert normalized coordinates to absolute
        const x = ann.x * containerWidth;
        const y = ann.y * containerHeight;

        return {
          annotation: ann,
          lines,
          lineHeight,
          textWidth,
          textHeight,
          pillWidth,
          pillHeight,
          x,
          y,
        };
      });
  }, [font, parsedAnnotations, containerWidth, containerHeight]);

  if (!font || captionMetrics.length === 0) {
    return null;
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {captionMetrics.map((metrics, index) => (
        <View
          key={index}
          style={[
            styles.captionContainer,
            {
              left: metrics.x,
              top: metrics.y,
              width: metrics.pillWidth,
              height: metrics.pillHeight,
            },
          ]}
        >
          <Canvas
            style={{
              width: metrics.pillWidth,
              height: metrics.pillHeight,
            }}
          >
            <Group>
              {/* Background pill */}
              <RoundedRect
                x={0}
                y={0}
                width={metrics.pillWidth}
                height={metrics.pillHeight}
                r={PILL_BORDER_RADIUS}
                color={PILL_BG_COLOR}
              />
              {/* Text lines */}
              {metrics.lines.map((line, lineIndex) => (
                <SkiaText
                  key={lineIndex}
                  x={PILL_PADDING_H}
                  y={PILL_PADDING_V + (lineIndex + 1) * metrics.lineHeight}
                  text={line}
                  font={font}
                  color={TEXT_COLOR}
                />
              ))}
            </Group>
          </Canvas>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  captionContainer: {
    position: "absolute",
    pointerEvents: "none",
  },
});
