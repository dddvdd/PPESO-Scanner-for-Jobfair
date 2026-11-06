export function rejectBrowserAutofill({ currentTarget, nativeEvent }, previousValue) {
  // Browsers may ignore autocomplete="off" and emit a replacement or a change
  // with no edit type. Keep the last accepted value in both the input and state.
  if (
    nativeEvent.inputType &&
    nativeEvent.inputType !== "insertReplacementText" &&
    !currentTarget.matches(":is(:autofill, :-webkit-autofill)")
  ) {
    return false;
  }
  currentTarget.value = previousValue;
  return true;
}
