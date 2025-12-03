# Logic Tests for useMessageFromNotification

## Running the Tests

```bash
# From repository root
node --test apps/expo/src/hooks/__tests__/useMessageFromNotification.test.ts
```

## Important Note

These tests focus on **business logic verification** rather than React hook behavior. For comprehensive React hook testing, you would want to use:

- `@testing-library/react-hooks` or `@testing-library/react-native`
- Jest or Vitest as the test runner
- Mock implementations for React Navigation and Expo Notifications

## What These Tests Cover

- Guard condition logic (when the effect should/shouldn't run)
- Message filtering by senderId
- Inbox cache update logic
- Instant message cache seeding
- First message extraction for marking as read
- Race condition prevention patterns
- Refetch fallback logic
- Edge case handling

## Test Philosophy

These tests verify the **logic patterns** used in the hook without requiring a full React testing environment. They ensure that:

- Filters work correctly
- State transformations are accurate
- Edge cases are handled
- The race condition prevention strategy is sound

## Future Improvements

To add full React hook integration testing:

1. Install `@testing-library/react-native`
2. Set up Jest or Vitest
3. Create mock implementations for:
   - `expo-notifications`
   - React Navigation
   - tRPC utils
4. Test actual hook behavior with `renderHook`
5. Verify useEffect timing and dependency behavior

## Example Full Integration Test

```typescript
import { renderHook } from '@testing-library/react-hooks';
import { useMessageFromNotification } from '../useMessageFromNotification';

it('should open viewer when messages found', () => {
  const openViewer = jest.fn();
  const { result } = renderHook(() =>
    useMessageFromNotification({
      senderId: 'sender-1',
      inbox: [mockMessage],
      // ... other params
      openViewer,
    })
  );

  expect(openViewer).toHaveBeenCalledWith([mockMessage]);
});
```