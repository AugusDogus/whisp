# Unit Tests for update-streak.ts

## Running the Tests

### Using Node.js built-in test runner (recommended for this project):

```bash
# From repository root
node --test packages/api/src/utils/__tests__/update-streak.test.ts

# Or if using experimental TypeScript support
node --test --experimental-strip-types packages/api/src/utils/__tests__/update-streak.test.ts
```

### Alternative: Add test script to package.json

Add to `packages/api/package.json`:

```json
{
  "scripts": {
    "test": "node --test src/utils/__tests__/*.test.ts"
  }
}
```

Then run:
```bash
cd packages/api
npm test
```

## Test Coverage

The test suite covers:

- **Case 1**: Other user hasn't sent anything yet
- **Case 2**: Gap exceeds 24 hours (streak reset)
- **Case 3a**: First cycle completion
- **Case 3b-i**: Streak increment logic
- **Case 3b-ii**: Streak maintenance (no increment)
- **Documentation timeline example**: Complete 6-step example from code comments
- **Edge cases**: Millisecond precision, epoch times, large numbers, timestamp equality
- **Boolean logic coverage**: All combinations of sent-since-update flags

## Test Philosophy

These tests focus on the **pure function** `calculateStreakUpdate`, which contains all the business logic for streak calculation. This makes the tests:

- Fast (no database or network dependencies)
- Deterministic (same input always produces same output)
- Easy to understand (each test is self-contained)
- Comprehensive (cover all code paths and edge cases)

The `updateStreak` function itself would require database mocking, which is beyond the scope of unit tests. Integration tests should cover that layer.