/**
 * SecureStorage.js - AES-GCM encrypted localStorage/sessionStorage wrapper
 *
 * Provides encryption-at-rest for browser storage to protect user data
 * from XSS attacks or malicious browser extensions.
 *
 * Features:
 * - AES-GCM 256-bit encryption
 * - Secure key derivation using PBKDF2
 * - Support for both localStorage and sessionStorage
 * - Automatic fallback to unencrypted storage if crypto unavailable
 * - In-memory fallback if storage unavailable
 * - Key rotation support
 * - Integrity verification via GCM authentication tag
 *
 * @example
 * const secureStorage = SecureStorage({
 *   storageKey: 'myApp:data',
 *   passphrase: 'user-specific-secret'
 * });
 * await secureStorage.init();
 * await secureStorage.setItem('userId', 'abc123');
 * const userId = await secureStorage.getItem('userId');
 */
(function() {
  'use strict';

  // Constants
  const ALGORITHM = 'AES-GCM';
  const KEY_LENGTH = 256;
  const IV_LENGTH = 12; // 96 bits recommended for GCM
  const SALT_LENGTH = 16;
  const PBKDF2_ITERATIONS = 100000;
  const VERSION = 1;
  const ENCRYPTED_PREFIX = '$enc$v1$';

  /**
   * Check if Web Crypto API is available
   * @returns {boolean}
   */
  function isCryptoAvailable() {
    return typeof crypto !== 'undefined' &&
           crypto.subtle &&
           typeof crypto.subtle.encrypt === 'function' &&
           typeof crypto.subtle.decrypt === 'function' &&
           typeof crypto.getRandomValues === 'function';
  }

  /**
   * Generate cryptographically secure random bytes
   * @param {number} length - Number of bytes
   * @returns {Uint8Array}
   */
  function getRandomBytes(length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return bytes;
  }

  /**
   * Convert Uint8Array to base64 string
   * @param {Uint8Array} bytes
   * @returns {string}
   */
  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 string to Uint8Array
   * @param {string} base64
   * @returns {Uint8Array}
   */
  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Encode string to UTF-8 Uint8Array
   * @param {string} str
   * @returns {Uint8Array}
   */
  function stringToBytes(str) {
    return new TextEncoder().encode(str);
  }

  /**
   * Decode UTF-8 Uint8Array to string
   * @param {Uint8Array} bytes
   * @returns {string}
   */
  function bytesToString(bytes) {
    return new TextDecoder().decode(bytes);
  }

  /**
   * Derive encryption key from passphrase using PBKDF2
   * @param {string} passphrase
   * @param {Uint8Array} salt
   * @returns {Promise<CryptoKey>}
   */
  async function deriveKey(passphrase, salt) {
    // Import passphrase as key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      stringToBytes(passphrase),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    // Derive AES-GCM key
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: ALGORITHM, length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt plaintext using AES-GCM
   * @param {string} plaintext
   * @param {CryptoKey} key
   * @returns {Promise<{iv: Uint8Array, ciphertext: Uint8Array}>}
   */
  async function encrypt(plaintext, key) {
    const iv = getRandomBytes(IV_LENGTH);
    const plaintextBytes = stringToBytes(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv: iv },
      key,
      plaintextBytes
    );

    return {
      iv: iv,
      ciphertext: new Uint8Array(ciphertext)
    };
  }

  /**
   * Decrypt ciphertext using AES-GCM
   * @param {Uint8Array} ciphertext
   * @param {Uint8Array} iv
   * @param {CryptoKey} key
   * @returns {Promise<string>}
   */
  async function decrypt(ciphertext, iv, key) {
    const plaintextBuffer = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: iv },
      key,
      ciphertext
    );

    return bytesToString(new Uint8Array(plaintextBuffer));
  }

  /**
   * Pack encrypted data into a storable string format
   * Format: $enc$v1$<salt>$<iv>$<ciphertext> (all base64)
   * @param {Uint8Array} salt
   * @param {Uint8Array} iv
   * @param {Uint8Array} ciphertext
   * @returns {string}
   */
  function packEncryptedData(salt, iv, ciphertext) {
    return ENCRYPTED_PREFIX +
           bytesToBase64(salt) + '$' +
           bytesToBase64(iv) + '$' +
           bytesToBase64(ciphertext);
  }

  /**
   * Unpack encrypted data from stored string
   * @param {string} packed
   * @returns {{version: number, salt: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array}|null}
   */
  function unpackEncryptedData(packed) {
    if (!packed || typeof packed !== 'string') {
      return null;
    }

    if (!packed.startsWith(ENCRYPTED_PREFIX)) {
      return null;
    }

    const parts = packed.slice(ENCRYPTED_PREFIX.length).split('$');
    if (parts.length !== 3) {
      return null;
    }

    try {
      return {
        version: VERSION,
        salt: base64ToBytes(parts[0]),
        iv: base64ToBytes(parts[1]),
        ciphertext: base64ToBytes(parts[2])
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Check if a value is encrypted
   * @param {string} value
   * @returns {boolean}
   */
  function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
  }

  /**
   * SecureStorage factory function
   * @param {Object} config
   * @param {string} [config.storageKey] - Namespace prefix for storage keys
   * @param {string} [config.passphrase] - Encryption passphrase (required for encryption)
   * @param {string} [config.storageType='local'] - 'local' or 'session'
   * @param {boolean} [config.encryptKeys=false] - Whether to encrypt storage keys
   * @param {boolean} [config.fallbackToUnencrypted=true] - Allow unencrypted fallback
   * @returns {Object} SecureStorage instance
   */
  function SecureStorage(config) {
    config = config || {};

    const prefix = config.storageKey ? config.storageKey + ':' : '';
    const passphrase = config.passphrase || null;
    const storageType = config.storageType === 'session' ? 'session' : 'local';
    const encryptKeys = config.encryptKeys === true;
    const fallbackToUnencrypted = config.fallbackToUnencrypted !== false;

    // State
    let encryptionKey = null;
    let salt = null;
    let initialized = false;
    let encryptionEnabled = false;
    const memoryFallback = {};

    /**
     * Get the underlying storage object
     * @returns {Storage|null}
     */
    function getStorage() {
      try {
        const storage = storageType === 'session'
          ? window.sessionStorage
          : window.localStorage;

        // Test if storage is actually available
        const testKey = '__secure_storage_test__';
        storage.setItem(testKey, 'test');
        storage.removeItem(testKey);
        return storage;
      } catch (e) {
        return null;
      }
    }

    /**
     * Get the salt storage key
     * @returns {string}
     */
    function getSaltKey() {
      return prefix + '__secure_salt__';
    }

    /**
     * Get the key registry storage key (for tracking encrypted keys)
     * @returns {string}
     */
    function getKeyRegistryKey() {
      return prefix + '__secure_keys__';
    }

    /**
     * Load the key registry from storage
     * @returns {Set<string>}
     */
    function loadKeyRegistry() {
      const storage = getStorage();
      if (!storage) return new Set();

      try {
        const raw = storage.getItem(getKeyRegistryKey());
        if (raw) {
          return new Set(JSON.parse(raw));
        }
      } catch (e) {
        // Ignore parse errors
      }
      return new Set();
    }

    /**
     * Save the key registry to storage
     * @param {Set<string>} registry
     */
    function saveKeyRegistry(registry) {
      const storage = getStorage();
      if (!storage) return;

      try {
        storage.setItem(getKeyRegistryKey(), JSON.stringify(Array.from(registry)));
      } catch (e) {
        // Ignore save errors
      }
    }

    /**
     * Add a key to the registry (only when encryptKeys is enabled)
     * @param {string} key
     */
    function addToKeyRegistry(key) {
      if (!encryptKeys) return;
      const registry = loadKeyRegistry();
      registry.add(key);
      saveKeyRegistry(registry);
    }

    /**
     * Remove a key from the registry
     * @param {string} key
     */
    function removeFromKeyRegistry(key) {
      if (!encryptKeys) return;
      const registry = loadKeyRegistry();
      registry.delete(key);
      saveKeyRegistry(registry);
    }

    /**
     * Clear the key registry
     */
    function clearKeyRegistry() {
      const storage = getStorage();
      if (storage) {
        storage.removeItem(getKeyRegistryKey());
      }
    }

    /**
     * Initialize the secure storage
     * Must be called before using encrypted operations
     * @returns {Promise<boolean>} Whether encryption is enabled
     */
    async function init() {
      if (initialized) {
        return encryptionEnabled;
      }

      const storage = getStorage();

      // Check if encryption is possible
      if (!passphrase || !isCryptoAvailable()) {
        encryptionEnabled = false;
        initialized = true;
        return false;
      }

      try {
        // Try to load existing salt or generate new one
        const saltKey = getSaltKey();
        let existingSalt = null;

        if (storage) {
          const storedSalt = storage.getItem(saltKey);
          if (storedSalt) {
            try {
              existingSalt = base64ToBytes(storedSalt);
            } catch (e) {
              // Invalid salt, will regenerate
            }
          }
        }

        if (existingSalt && existingSalt.length === SALT_LENGTH) {
          salt = existingSalt;
        } else {
          salt = getRandomBytes(SALT_LENGTH);
          if (storage) {
            storage.setItem(saltKey, bytesToBase64(salt));
          }
        }

        // Derive encryption key
        encryptionKey = await deriveKey(passphrase, salt);
        encryptionEnabled = true;
        initialized = true;
        return true;
      } catch (e) {
        encryptionEnabled = false;
        initialized = true;
        return false;
      }
    }

    /**
     * Ensure storage is initialized
     * @returns {Promise<void>}
     */
    async function ensureInit() {
      if (!initialized) {
        await init();
      }
    }

    /**
     * Get the full storage key with prefix
     * @param {string} key
     * @returns {Promise<string>}
     */
    async function getFullKey(key) {
      if (encryptKeys && encryptionEnabled && encryptionKey) {
        // Hash the key for privacy, but include prefix so clear/keys/etc work
        const keyBytes = stringToBytes(prefix + key);
        const hashBuffer = await crypto.subtle.digest('SHA-256', keyBytes);
        return prefix + '__ek__' + bytesToBase64(new Uint8Array(hashBuffer)).slice(0, 32);
      }
      return prefix + key;
    }

    /**
     * Set an item in secure storage
     * @param {string} key
     * @param {*} value - Will be JSON stringified
     * @returns {Promise<boolean>} Success status
     */
    async function setItem(key, value) {
      await ensureInit();

      const storage = getStorage();
      const fullKey = await getFullKey(key);
      const jsonValue = JSON.stringify(value);

      try {
        let storedValue;

        if (encryptionEnabled && encryptionKey) {
          const { iv, ciphertext } = await encrypt(jsonValue, encryptionKey);
          storedValue = packEncryptedData(salt, iv, ciphertext);
        } else if (fallbackToUnencrypted) {
          storedValue = jsonValue;
        } else {
          throw new Error('Encryption required but not available');
        }

        if (storage) {
          storage.setItem(fullKey, storedValue);
        } else {
          memoryFallback[fullKey] = storedValue;
        }

        // Track key in registry when encryptKeys is enabled
        addToKeyRegistry(key);

        return true;
      } catch (e) {
        // Store in memory as last resort
        memoryFallback[fullKey] = jsonValue;
        return false;
      }
    }

    /**
     * Get an item from secure storage
     * @param {string} key
     * @param {*} [defaultValue=null] - Value to return if key not found
     * @returns {Promise<*>} Parsed value or defaultValue
     */
    async function getItem(key, defaultValue) {
      if (defaultValue === undefined) {
        defaultValue = null;
      }

      await ensureInit();

      const storage = getStorage();
      const fullKey = await getFullKey(key);

      try {
        let storedValue = null;

        if (storage) {
          storedValue = storage.getItem(fullKey);
        }

        if (storedValue === null) {
          storedValue = memoryFallback[fullKey] || null;
        }

        if (storedValue === null) {
          return defaultValue;
        }

        // Check if value is encrypted
        if (isEncrypted(storedValue)) {
          if (!encryptionEnabled || !encryptionKey) {
            // Can't decrypt without key
            return defaultValue;
          }

          const unpacked = unpackEncryptedData(storedValue);
          if (!unpacked) {
            return defaultValue;
          }

          // Re-derive key with stored salt if different
          let decryptKey = encryptionKey;
          if (!arraysEqual(unpacked.salt, salt)) {
            decryptKey = await deriveKey(passphrase, unpacked.salt);
          }

          const plaintext = await decrypt(
            unpacked.ciphertext,
            unpacked.iv,
            decryptKey
          );
          return JSON.parse(plaintext);
        } else {
          // Unencrypted value
          return JSON.parse(storedValue);
        }
      } catch (e) {
        return defaultValue;
      }
    }

    /**
     * Remove an item from secure storage
     * @param {string} key
     * @returns {Promise<boolean>} Success status
     */
    async function removeItem(key) {
      await ensureInit();

      const storage = getStorage();
      const fullKey = await getFullKey(key);

      try {
        if (storage) {
          storage.removeItem(fullKey);
        }
        delete memoryFallback[fullKey];

        // Remove from key registry when encryptKeys is enabled
        removeFromKeyRegistry(key);

        return true;
      } catch (e) {
        return false;
      }
    }

    /**
     * Check if a key exists in secure storage
     * @param {string} key
     * @returns {Promise<boolean>}
     */
    async function hasItem(key) {
      await ensureInit();

      const storage = getStorage();
      const fullKey = await getFullKey(key);

      if (storage) {
        return storage.getItem(fullKey) !== null;
      }
      return fullKey in memoryFallback;
    }

    /**
     * Clear all items with this storage's prefix
     * @returns {Promise<boolean>} Success status
     */
    async function clear() {
      await ensureInit();

      const storage = getStorage();

      try {
        if (storage && prefix) {
          // Only clear items with our prefix
          const keysToRemove = [];
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key && key.startsWith(prefix)) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach(key => storage.removeItem(key));
        } else if (storage && !prefix) {
          storage.clear();
        }

        // Clear memory fallback
        Object.keys(memoryFallback).forEach(key => {
          if (!prefix || key.startsWith(prefix)) {
            delete memoryFallback[key];
          }
        });

        // Clear key registry when encryptKeys is enabled
        clearKeyRegistry();

        return true;
      } catch (e) {
        return false;
      }
    }

    /**
     * Get all keys (without prefix) in this storage namespace
     * @returns {Promise<string[]>}
     */
    async function keys() {
      await ensureInit();

      // When encryptKeys is enabled, use the key registry
      if (encryptKeys && encryptionEnabled) {
        const registry = loadKeyRegistry();
        return Array.from(registry);
      }

      const storage = getStorage();
      const result = [];

      if (storage) {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key && key.startsWith(prefix) &&
              !key.endsWith('__secure_salt__') &&
              !key.endsWith('__secure_keys__')) {
            result.push(key.slice(prefix.length));
          }
        }
      }

      // Add memory fallback keys
      Object.keys(memoryFallback).forEach(key => {
        if (key.startsWith(prefix) &&
            !key.endsWith('__secure_salt__') &&
            !key.endsWith('__secure_keys__')) {
          const shortKey = key.slice(prefix.length);
          if (!result.includes(shortKey)) {
            result.push(shortKey);
          }
        }
      });

      return result;
    }

    /**
     * Rotate encryption key with new passphrase
     * Re-encrypts all data with new key
     * @param {string} newPassphrase
     * @returns {Promise<boolean>} Success status
     */
    async function rotateKey(newPassphrase) {
      if (!newPassphrase) {
        return false;
      }

      await ensureInit();

      try {
        // Get all current data
        const allKeys = await keys();
        const allData = {};

        for (const key of allKeys) {
          allData[key] = await getItem(key);
        }

        // Generate new salt and derive new key
        const newSalt = getRandomBytes(SALT_LENGTH);
        const newKey = await deriveKey(newPassphrase, newSalt);

        // Update state
        salt = newSalt;
        encryptionKey = newKey;

        // Store new salt
        const storage = getStorage();
        if (storage) {
          storage.setItem(getSaltKey(), bytesToBase64(salt));
        }

        // Re-encrypt all data
        for (const key of Object.keys(allData)) {
          await setItem(key, allData[key]);
        }

        return true;
      } catch (e) {
        return false;
      }
    }

    /**
     * Migrate unencrypted data to encrypted format
     * @param {string[]} keysToMigrate - Array of keys to migrate
     * @returns {Promise<{migrated: number, failed: number}>}
     */
    async function migrateToEncrypted(keysToMigrate) {
      await ensureInit();

      if (!encryptionEnabled) {
        return { migrated: 0, failed: keysToMigrate.length };
      }

      const storage = getStorage();
      let migrated = 0;
      let failed = 0;

      for (const key of keysToMigrate) {
        try {
          const fullKey = await getFullKey(key);
          let rawValue = null;

          if (storage) {
            rawValue = storage.getItem(fullKey);
          }

          if (rawValue === null) {
            rawValue = memoryFallback[fullKey];
          }

          if (rawValue !== null && !isEncrypted(rawValue)) {
            // Parse and re-save to encrypt
            const value = JSON.parse(rawValue);
            await setItem(key, value);
            migrated++;
          }
        } catch (e) {
          failed++;
        }
      }

      return { migrated, failed };
    }

    /**
     * Get storage statistics
     * @returns {Promise<Object>}
     */
    async function getStats() {
      await ensureInit();

      const storage = getStorage();
      let totalSize = 0;
      let encryptedCount = 0;
      let unencryptedCount = 0;

      if (storage) {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key && key.startsWith(prefix) &&
              !key.endsWith('__secure_salt__') &&
              !key.endsWith('__secure_keys__')) {
            const value = storage.getItem(key);
            if (value) {
              totalSize += key.length + value.length;
              if (isEncrypted(value)) {
                encryptedCount++;
              } else {
                unencryptedCount++;
              }
            }
          }
        }
      }

      return {
        encryptionEnabled,
        storageType,
        prefix,
        totalSize,
        encryptedCount,
        unencryptedCount,
        hasMemoryFallback: Object.keys(memoryFallback).length > 0
      };
    }

    /**
     * Check if encryption is currently enabled
     * @returns {boolean}
     */
    function isEncryptionEnabled() {
      return encryptionEnabled;
    }

    /**
     * Check if storage has been initialized
     * @returns {boolean}
     */
    function isInitialized() {
      return initialized;
    }

    // Return public API
    return {
      init,
      setItem,
      getItem,
      removeItem,
      hasItem,
      clear,
      keys,
      rotateKey,
      migrateToEncrypted,
      getStats,
      isEncryptionEnabled,
      isInitialized
    };
  }

  /**
   * Compare two Uint8Arrays for equality
   * @param {Uint8Array} a
   * @param {Uint8Array} b
   * @returns {boolean}
   */
  function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /**
   * Create a synchronous-compatible wrapper for simple use cases
   * Pre-initializes and caches results for sync-like access
   * @param {Object} config - Same as SecureStorage config
   * @returns {Object} Sync-compatible storage interface
   */
  function SecureStorageSync(config) {
    const asyncStorage = SecureStorage(config);
    const cache = {};
    let initPromise = null;

    /**
     * Initialize and preload data
     * @param {string[]} [preloadKeys=[]] - Keys to preload into cache
     * @returns {Promise<void>}
     */
    async function init(preloadKeys) {
      preloadKeys = preloadKeys || [];
      await asyncStorage.init();
      for (const key of preloadKeys) {
        cache[key] = await asyncStorage.getItem(key);
      }
    }

    /**
     * Get item from cache (sync) or storage (async)
     * @param {string} key
     * @param {*} defaultValue
     * @returns {*} Cached value or defaultValue
     */
    function getItem(key, defaultValue) {
      if (key in cache) {
        return cache[key];
      }
      return defaultValue;
    }

    /**
     * Set item in cache and storage
     * @param {string} key
     * @param {*} value
     */
    function setItem(key, value) {
      cache[key] = value;
      asyncStorage.setItem(key, value).catch(function() {});
    }

    /**
     * Remove item from cache and storage
     * @param {string} key
     */
    function removeItem(key) {
      delete cache[key];
      asyncStorage.removeItem(key).catch(function() {});
    }

    /**
     * Get the underlying async storage
     * @returns {Object}
     */
    function getAsyncStorage() {
      return asyncStorage;
    }

    return {
      init,
      getItem,
      setItem,
      removeItem,
      getAsyncStorage
    };
  }

  // Export to window
  window.SecureStorage = SecureStorage;
  window.SecureStorageSync = SecureStorageSync;

  // Also support module exports if available
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SecureStorage, SecureStorageSync };
  }

})();
