const mqtt = require('mqtt');

class MqttService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.init();
  }

  init() {
    const host = process.env.MQTT_HOST;
    const port = process.env.MQTT_PORT;
    const username = process.env.MQTT_USERNAME;
    const password = process.env.MQTT_PASSWORD;

    if (!host) {
      console.warn('⚠️ MQTT_HOST not found in .env. MQTT service will not connect.');
      return;
    }

    const brokerUrl = `mqtt://${host}:${port || 1883}`;

    console.log(`Connecting to MQTT broker at ${brokerUrl}...`);

    this.client = mqtt.connect(brokerUrl, {
      username: username || undefined,
      password: password || undefined,
      reconnectPeriod: 5000,
    });

    this.client.on('connect', () => {
      console.log('✅ Connected to MQTT broker');
      this.isConnected = true;
    });

    this.client.on('error', (err) => {
      console.error('❌ MQTT Connection Error:', err.message);
    });

    this.client.on('offline', () => {
      console.warn('⚠️ MQTT client is offline');
      this.isConnected = false;
    });
  }

  /**
   * Publishes an open door command to the MQTT broker
   * @param {string} memberId 
   * @param {string} fingerprintId 
   * @param {string} device 
   * @param {string} time 
   */
  async publishOpenDoor(memberId, fingerprintId, device, time) {
    if (!this.isConnected || !this.client) {
      console.error('❌ Cannot publish MQTT: Not connected to broker');
      return false;
    }

    const topic = 'gym/main-door';
    const payload = JSON.stringify({
      action: 'OPEN',
      memberId,
      fingerprintId,
      device: device || process.env.DEVICE_NAME || 'SenseFace-M2F-LR',
      time: time || new Date().toISOString()
    });

    return new Promise((resolve, reject) => {
      console.log(`Publishing MQTT... Topic: ${topic}`);
      this.client.publish(topic, payload, { qos: 1 }, (err) => {
        if (err) {
          console.error('❌ MQTT Publish failed:', err);
          return resolve(false);
        }
        console.log('✅ Door Open Request Sent');
        resolve(true);
      });
    });
  }
}

// Export a singleton instance
module.exports = new MqttService();
