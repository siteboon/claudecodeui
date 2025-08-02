import net from 'net';

/**
 * Check if a port is available
 * @param {number} port - Port to check
 * @returns {Promise<boolean>} - True if port is available
 */
export function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Find an available port starting from a given port
 * @param {number} startPort - Starting port number
 * @param {number} maxAttempts - Maximum number of ports to try
 * @returns {Promise<number>} - Available port number
 */
export async function findAvailablePort(startPort = 3000, maxAttempts = 100) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }
  throw new Error(`No available ports found between ${startPort} and ${startPort + maxAttempts - 1}`);
}

/**
 * Find two different available ports
 * @param {number} startPort1 - Starting port for first search
 * @param {number} startPort2 - Starting port for second search
 * @returns {Promise<{port1: number, port2: number}>} - Two available ports
 */
export async function findTwoAvailablePorts(startPort1 = 3000, startPort2 = 3001) {
  const port1 = await findAvailablePort(startPort1);
  // Ensure second port is different from first
  const port2 = await findAvailablePort(startPort2 === port1 ? startPort2 + 1 : startPort2);
  return { port1, port2 };
}