import { z } from "zod/v4";

export const unused = z.string().describe(
  `This lib is currently not used as we use drizzle-zod for simple schemas
   But as your application grows and you need other validators to share
   with back and frontend, you can put them in here
  `,
);

// Annotation schemas for media captions
export const AnnotationSchema = z.object({
  id: z.string(),
  type: z.literal("caption"),
  text: z.string(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  fontSize: z.number().positive(),
  color: z.string().optional().default("#FFFFFF"),
});

export const AnnotationsSchema = z.array(AnnotationSchema).optional();
export type Annotation = z.infer<typeof AnnotationSchema>;
