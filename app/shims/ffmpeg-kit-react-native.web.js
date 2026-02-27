export const FFmpegKit = {
  execute: async () => ({
    getReturnCode: async () => null,
  }),
};

export const ReturnCode = {
  isSuccess: () => false,
  isCancel: () => false,
  isError: () => true,
};

export default {};