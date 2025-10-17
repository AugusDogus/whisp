<!-- 3a49840c-a1a2-47f2-b6ec-508eaab7bdf6 e1496929-bd6e-4ac6-b434-a14780ce170c -->
# Add Snapchat-style Caption Feature to Media Screen

## Architecture Overview

Store captions as **metadata** (not rendered into media files) to support both photos and videos. Use `@shopify/react-native-skia` for rendering captions on the sender's device during composition and on recipients' devices during playback.

## Implementation Steps

### 1. Install Dependencies

Add `@shopify/react-native-skia` to `/Users/augie/dev/whisp/apps/expo/package.json`:

```bash
cd apps/expo && npx expo install @shopify/react-native-skia
```

### 2. Database Schema Changes (Backwards Compatible)

**File: `/Users/augie/dev/whisp/packages/db/src/schema.ts`**

Add optional `annotations` TEXT column to `Message` table:

```typescript
annotations: t.text(), // JSON string of Annotation[]
```

Create Zod schemas for type safety:

```typescript
export const AnnotationSchema = z.object({
  id: z.string(),
  type: z.literal('caption'),
  text: z.string(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  fontSize: z.number().positive(),
  color: z.string().optional().default('#FFFFFF'),
});

export const AnnotationsSchema = z.array(AnnotationSchema).optional();
export type Annotation = z.infer<typeof AnnotationSchema>;
```

Update `CreateMessageSchema` to handle JSON serialization:

```typescript
annotations: AnnotationsSchema.transform(val => val ? JSON.stringify(val) : undefined)
```

Generate and apply migration (backwards compatible - nullable column).

### 3. API Changes

**File: `/Users/augie/dev/whisp/packages/api/src/router/*.ts`**

Update the upload input schema to accept annotations:

```typescript
input: z.object({
  recipients: z.array(z.string()),
  mimeType: z.string(),
  thumbhash: z.string().optional(),
  annotations: AnnotationsSchema, // Add this
})
```

Update message creation to store annotations in database.

### 4. Media Screen Caption UI

**File: `/Users/augie/dev/whisp/apps/expo/src/app/media.tsx`**

Transform the screen to support caption editing:

**State Management:**

```typescript
const [caption, setCaption] = useState<{
  text: string;
  x: number; // normalized 0-1
  y: number; // normalized 0-1
  isEditing: boolean;
} | null>(null);

const [viewMetrics, setViewMetrics] = useState<{
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
} | null>(null);
```

**Rendering Layers:**

- Base layer: Photo/video (existing)
- Skia overlay: Caption pill + text (when not editing)
- Native TextInput overlay: For editing mode (keyboard + caret)

**Interaction:**

- Tap on empty area → create caption at tap point, enter edit mode
- Tap on existing caption → enter edit mode
- Drag caption → pan gesture (react-native-gesture-handler)
- Bounds checking: keep caption within image bounds with margin

**Controls (integrate with existing toolbar):**

- "Done" button → exits edit mode (or keyboard dismiss)
- "Clear" button → removes caption
- Keep existing "Cancel" and "Send" buttons

### 5. Caption Component

**New File: `/Users/augie/dev/whisp/apps/expo/src/components/caption-editor.tsx`**

Create reusable caption editing component:

- Skia Canvas for rendering caption pill + text
- PanGestureHandler for dragging
- TextInput overlay for editing
- Helper functions for coordinate transformations (view ↔ normalized)

**Appearance:**

- White text (#FFFFFF)
- Semi-transparent black pill background (rgba(0,0,0,0.6))
- Border radius: 16px
- Padding: horizontal 12px, vertical 6px
- Font size: 24
- Multiline with wrapping at 90% canvas width

### 6. Export Logic

**Update: `/Users/augie/dev/whisp/apps/expo/src/utils/media-upload.ts`**

Modify `uploadMedia` to include annotations:

```typescript
export async function uploadMedia(params: UploadMediaParams & {
  annotations?: Annotation[];
}): Promise<void>
```

Pass annotations array to `uploadFilesWithInput` input.

### 7. Message Viewing (Recipients)

**Files to update:**

- `/Users/augie/dev/whisp/apps/expo/src/app/friends.tsx` (or wherever messages are viewed)

When displaying received messages:

- Parse `annotations` JSON from message data
- Render media file
- Overlay Skia canvas with captions using same rendering logic
- Use normalized coordinates to position captions on recipient's screen

### 8. Android Back Button Handling

**In media.tsx:**

Add `BackHandler` listener:

```typescript
useEffect(() => {
  const handler = BackHandler.addEventListener('hardwareBackPress', () => {
    if (caption?.isEditing && Keyboard.isVisible()) {
      Keyboard.dismiss();
      return true; // Handled
    }
    return false; // Let default behavior (navigate back) happen
  });
  return () => handler.remove();
}, [caption?.isEditing]);
```

### 9. Type Definitions

**Update: `/Users/augie/dev/whisp/apps/expo/src/navigation/types.ts`**

Extend `Media` route params if needed for annotations (probably not needed since they're created on the screen).

## Key Technical Details

- **Coordinate System**: Normalized (0-1) for resolution independence
- **Font Size**: Fixed at 24 (no user scaling)
- **Single Caption**: UI supports one caption at a time per current requirements
- **No Placeholder**: Caption only appears when user taps to create
- **Multiline**: Text wraps at 90% of canvas width
- **Performance**: Skia renders at 60fps, smooth dragging
- **Accessibility**: Add accessibilityLabel to caption element

## Development Workflow

### Quality Checks

Run these commands periodically during development to catch issues early (from the top-level directory `/Users/augie/dev/whisp`):

```bash
bun typecheck  # TypeScript compilation check
bun lint       # ESLint validation
bun format     # Prettier formatting
```

Run all three after:
- Completing each implementation step
- Before committing changes
- After making schema or API changes

### CLI Usage Policy

**IMPORTANT**: Never run `npx` or `bunx` commands without asking first. This monorepo has specific conventions for:
- Package installation
- Code generation
- Database migrations
- Build tools

Always ask which command to use for tasks like:
- Installing dependencies
- Running migrations
- Generating types
- Building packages

## Testing Checklist

- [ ] Create caption on photo by tapping
- [ ] Create caption on video by tapping
- [ ] Drag caption to move position
- [ ] Caption stays within bounds
- [ ] Edit existing caption by tapping it
- [ ] Delete caption by clearing text
- [ ] Android back dismisses keyboard, then navigates back
- [ ] Send media with caption
- [ ] Recipient sees caption in correct position
- [ ] Recipient sees caption on both photos and videos
- [ ] Existing messages without captions still work (backwards compatible)

### To-dos

- [ ] Install @shopify/react-native-skia dependency
- [ ] Add annotations column to Message table with Zod schemas and run migration
- [ ] Update API upload input schema to accept annotations
- [ ] Create caption-editor component with Skia rendering and gesture handling
- [ ] Integrate caption editing into media.tsx with state management and controls
- [ ] Update media-upload.ts to pass annotations to API
- [ ] Add caption rendering to message viewing screens for recipients
- [ ] Implement Android back button handler for keyboard dismissal