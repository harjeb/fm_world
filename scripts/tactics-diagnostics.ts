/**
 * 旧单场诊断曾混入双方防守宽度，且对照更换了进攻方，不能用于因果比较。
 * 请使用成对消融：npm run tactics:ablation -- --n 4
 */
console.error('旧诊断口径存在错误，已停用。请使用 npm run tactics:ablation -- --n 4')
process.exitCode = 1
