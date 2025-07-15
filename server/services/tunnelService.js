import { tunnelmole } from 'tunnelmole';

class TunnelService {
  constructor() {
    this.tunnel = null;
    this.url = null;
    this.isActive = false;
    this.startTime = null;
    this.error = null;
  }

  async start(port) {
    if (this.isActive) {
      console.log('Tunnel already active at:', this.url);
      return { url: this.url, startTime: this.startTime };
    }

    try {
      console.log(`Starting Tunnelmole on port ${port}...`);
      
      // Start tunnelmole
      this.url = await tunnelmole({
        port: port
      });
      
      this.isActive = true;
      this.startTime = new Date();
      this.error = null;
      
      console.log(`Tunnelmole started successfully: ${this.url}`);
      
      return {
        url: this.url,
        startTime: this.startTime,
        status: 'active'
      };
    } catch (error) {
      console.error('Failed to start Tunnelmole:', error);
      this.error = error.message;
      this.isActive = false;
      throw error;
    }
  }

  async stop() {
    if (!this.isActive) {
      console.log('Tunnel is not active');
      return { status: 'stopped' };
    }

    try {
      // Tunnelmole doesn't provide a direct stop method in the API
      // The connection will be closed when the process ends
      // For now, we just mark it as inactive
      this.isActive = false;
      this.url = null;
      this.startTime = null;
      
      console.log('Tunnel stopped');
      
      return { status: 'stopped' };
    } catch (error) {
      console.error('Error stopping tunnel:', error);
      throw error;
    }
  }

  getStatus() {
    return {
      isActive: this.isActive,
      url: this.url,
      startTime: this.startTime,
      error: this.error,
      uptime: this.isActive && this.startTime ? 
        Math.floor((Date.now() - this.startTime.getTime()) / 1000) : 0
    };
  }

  getShareableUrl() {
    if (!this.url) {
      return null;
    }
    
    // Return the public URL that can be shared
    return this.url;
  }
}

// Export singleton instance
export default new TunnelService();