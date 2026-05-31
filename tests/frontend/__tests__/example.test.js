// Example test to verify Jest is working
describe('Jest Setup', () => {
  test('Jest is configured correctly', () => {
    expect(true).toBe(true);
  });

  test('jsdom environment is available', () => {
    expect(document).toBeDefined();
    expect(window).toBeDefined();
  });

  test('localStorage mock is available', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem');
    localStorage.setItem('test', 'value');
    expect(spy).toHaveBeenCalledWith('test', 'value');
    spy.mockRestore();
  });
});
