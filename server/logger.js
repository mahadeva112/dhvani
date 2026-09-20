const stamp = () => new Date().toISOString().slice(11, 23);

const write = (stream, level, color, args) => {
  stream.write(`${color}[${stamp()}] ${level}\u001b[0m ${args.join(' ')}\n`);
};

export const logger = {
  info: (...args) => write(process.stdout, 'INFO ', '\u001b[36m', args),
  warn: (...args) => write(process.stdout, 'WARN ', '\u001b[33m', args),
  error: (...args) => write(process.stderr, 'ERROR', '\u001b[31m', args),
  success: (...args) => write(process.stdout, 'OK   ', '\u001b[32m', args),
};
