// RELOOP Minimal Backend - Testnet E-Waste Recycling
// Deploy on Vercel/Netlify Functions with zero infrastructure

import { Fireblocks } from '@fireblocks/sdk';
import { Lucid, Blockfrost, Data, fromText, toHex } from 'lucid-cardano';
import crypto from 'crypto';

// =============================================================================
// TESTNET CONFIGURATION & INITIALIZATION
// =============================================================================

// Initialize Fireblocks for custodial wallet management
const fireblocks = new Fireblocks({
  apiKey: process.env.FIREBLOCKS_API_KEY,
  privateKey: process.env.FIREBLOCKS_PRIVATE_KEY,
  baseUrl: "https://sandbox-api.fireblocks.io" // Testnet/Sandbox
});

// Initialize Lucid for Cardano TESTNET
let lucid;
async function initializeLucid() {
  if (!lucid) {
    lucid = await Lucid.new(
      new Blockfrost(
        "https://cardano-preprod.blockfrost.io/api/v0", // Testnet
        process.env.BLOCKFROST_PROJECT_ID
      ),
      "Preprod" // Testnet network
    );
    
    // Set backend wallet for signing transactions
    lucid.selectWalletFromSeed(process.env.BACKEND_WALLET_SEED);
  }
  return lucid;
}

// Contract addresses (deploy on testnet first)
const CONTRACTS = {
  DROP_ADDRESS: process.env.DROP_CONTRACT_ADDRESS || "addr_test1_drop_contract",
  TREASURY_ADDRESS: process.env.TREASURY_CONTRACT_ADDRESS || "addr_test1_treasury",
  USER_REGISTRY_ADDRESS: process.env.USER_REGISTRY_ADDRESS || "addr_test1_registry",
  DROP_VALIDATOR: process.env.DROP_VALIDATOR_SCRIPT,
  BACKEND_WALLET_ID: process.env.FIREBLOCKS_BACKEND_WALLET
};

// Simplified reward structure (testnet amounts - smaller values)
const DEVICE_REWARDS = {
  
  'usb_cable': { risk: 'Safe', reward: 1},
  'phone_charger': { risk: 'Safe', reward: 1},
  'audio_cable': { risk: 'Safe', reward: 1 },
    'hdmi_cable': { risk: 'LowRisk', reward: 1 },
  'ethernet_cable': { risk: 'LowRisk', reward: 1 },
 
  
  'led_bulb': { risk: 'LowRisk', reward: 1},
  'remote_control': { risk: 'LowRisk', reward: 1},
'cfl_light': { risk: 'LowRisk', reward: 1},
  'small_electronics': { risk: 'LowRisk', reward: 1},
  'calculator': { risk: 'LowRisk', reward: 1},
 
  
  
  'smartphone': { risk: 'MediumRisk', reward: 2},
  'bluetooth_speaker': { risk: 'MediumRisk', reward: 2 },
  'fitness_tracker': { risk: 'MediumRisk', reward: 2},
'small_appliances': { risk: 'MediumRisk', reward: 2},
    'wireless_devices': { risk: 'MediumRisk', reward: 2},
   
  
  'laptop': { risk: 'HighRisk', reward:  2},
  'tablet': { risk: 'HighRisk', reward: 2},
  'gaming_device': { risk: 'HighRisk', reward: 2},  
  'desktop_computer': { risk: 'HighRisk', reward: 2},
  'monitor': { risk: 'HighRisk', reward: 2},
  
  
  'power_bank': { risk: 'VeryHighRisk', reward: 3 },
  'laptop_battery': { risk: 'VeryHighRisk', reward: 3 },
  'car_battery': { risk: 'VeryHighRisk', reward: 3},
  'ups_battery': { risk: 'VeryHighRisk', reward: 3 },
  
};

// =============================================================================
// 1. REGISTER USER - Creates custodial wallet + blockchain registration
// =============================================================================
export async function registerUser(req, res) {
  try {
    const { email, name } = req.body;
    
    if (!email || !name) {
      return res.status(400).json({ error: "Email and name required" });
    }
    
    // Create deterministic user ID
    const userId = crypto.createHash('sha256')
      .update(email.toLowerCase().trim())
      .digest('hex').slice(0, 16);
    
    // Create Fireblocks custodial wallet
    const wallet = await fireblocks.vaults.createVaultAccount({
      name: `RELOOP-${name}-${userId}`,
      customerRefId: userId
    });
    
    // Generate testnet ADA address
    await fireblocks.vaults.createVaultAccountAsset({
      vaultAccountId: wallet.id,
      assetId: 'ADA_TEST' // Testnet ADA
    });
    
    const addresses = await fireblocks.vaults.getDepositAddresses({
      vaultAccountId: wallet.id,
      assetId: 'ADA_TEST'
    });
    
    const walletAddress = addresses[0].address;
    
    // Register user on testnet blockchain
    const txHash = await registerUserOnChain(userId, walletAddress);
    
    res.json({
      success: true,
      userId,
      walletAddress,
      fireblocksWalletId: wallet.id,
      registrationTxHash: txHash,
      network: "Cardano Testnet",
      message: "User registered! Ready to earn testnet ADA rewards."
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      error: "Registration failed",
      details: error.message
    });
  }
}

// =============================================================================
// 2. SUBMIT DROP - Recycle item and get instant rewards
// =============================================================================
export async function submitDrop(req, res) {
  try {
    const { userId, binId, deviceType, location, photoData } = req.body;
    
    // Validate required fields
    if (!userId || !binId || !deviceType || !location) {
      return res.status(400).json({ 
        error: "Missing fields: userId, binId, deviceType, location required" 
      });
    }
    
    // Validate device type
    if (!DEVICE_REWARDS[deviceType]) {
      return res.status(400).json({ 
        error: "Invalid device type",
        validTypes: Object.keys(DEVICE_REWARDS)
      });
    }
    
    // Get user wallet from blockchain (no database lookup needed)
    const userWallet = await getUserWalletFromChain(userId);
    if (!userWallet) {
      return res.status(400).json({ 
        error: "User not found. Please register first." 
      });
    }
    
    // Process photo (mock IPFS for simplicity)
    const photoHash = photoData ? 
      `Qm${crypto.createHash('sha256').update(photoData).digest('hex').slice(0, 44)}` :
      `QmMockPhoto${crypto.randomBytes(8).toString('hex')}`;
    
    // Get reward info
    const deviceConfig = DEVICE_REWARDS[deviceType];
    const dropId = crypto.randomBytes(16).toString('hex');
    
    // Submit to blockchain with auto-distribution
    const dropData = {
      userId,
      binId,
      photoHash,
      deviceType,
      environmentalRisk: deviceConfig.risk,
      location: {
        latitude: Math.round(location.latitude * 1000000),
        longitude: Math.round(location.longitude * 1000000)
      },
      dropId,
      userWallet,
      rewardAmount: deviceConfig.reward,
      autoDistribute: true
    };
    
    const txHash = await submitDropOnChain(dropData);
    
    res.json({
      success: true,
      dropId,
      transactionHash: txHash,
      reward: {
        amount: `${deviceConfig.reward / 1000000} tADA`,
        environmentalRisk: deviceConfig.risk,
        deviceType
      },
      photoHash,
      network: "Cardano Testnet",
      message: "Drop submitted! Testnet ADA reward will be sent automatically."
    });
    
  } catch (error) {
    console.error('Submit drop error:', error);
    res.status(500).json({ 
      error: "Drop submission failed",
      details: error.message
    });
  }
}

// =============================================================================
// 3. GET USER BALANCE - Check testnet balance and stats
// =============================================================================
export async function getUserBalance(req, res) {
  try {
    const { userId } = req.params;
    
    // Get user data from blockchain only
    const userStats = await getUserStatsFromChain(userId);
    if (!userStats) {
      return res.status(404).json({ error: "User not found" });
    }
    
    // Get Fireblocks testnet balance
    let fireblocksBalance = "0";
    try {
      const balance = await fireblocks.vaults.getVaultAccountAsset({
        vaultAccountId: userStats.fireblocksWalletId,
        assetId: 'ADA_TEST'
      });
      fireblocksBalance = balance.available || "0";
    } catch (e) {
      console.log('Fireblocks balance fetch failed:', e.message);
    }
    
    // Get recent drops from blockchain
    const recentDrops = await getUserRecentDrops(userId, 5);
    
    res.json({
      userId,
      walletAddress: userStats.walletAddress,
      network: "Cardano Testnet",
      balance: {
        custodialWallet: `${fireblocksBalance} tADA`,
        totalEarned: `${userStats.totalEarned / 1000000} tADA`,
        pendingRewards: `${userStats.pendingRewards / 1000000} tADA`
      },
      stats: {
        totalDrops: userStats.totalDrops,
        lastActivity: new Date(userStats.lastActivity).toISOString(),
        registrationDate: new Date(userStats.createdTimestamp).toISOString()
      },
      recentDrops: recentDrops.map(drop => ({
        dropId: drop.dropId,
        deviceType: drop.deviceType,
        reward: `${DEVICE_REWARDS[drop.deviceType]?.reward / 1000000 || 2} tADA`,
        timestamp: new Date(drop.timestamp).toISOString(),
        status: drop.rewardClaimed ? 'Claimed' : 'Pending'
      }))
    });
    
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({ 
      error: "Failed to get balance",
      details: error.message
    });
  }
}

// =============================================================================
// 4. BATCH PROCESS - Admin processes pending testnet rewards
// =============================================================================
export async function batchProcess(req, res) {
  try {
    // Simple admin auth check
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.ADMIN_TOKEN}`) {
      return res.status(403).json({ error: "Admin access required" });
    }
    
    // Get pending drops from blockchain
    const pendingDrops = await getPendingDropsFromChain();
    
    if (pendingDrops.length === 0) {
      return res.json({ 
        success: true,
        message: "No pending drops to process",
        network: "Cardano Testnet"
      });
    }
    
    // Process in batches of 5 (smaller batches for testnet)
    const batchSize = 5;
    const results = [];
    
    for (let i = 0; i < pendingDrops.length; i += batchSize) {
      const batch = pendingDrops.slice(i, i + batchSize);
      const dropIds = batch.map(drop => drop.dropId);
      
      try {
        const txHash = await batchDistributeRewards(dropIds);
        
        const batchRewards = batch.reduce((sum, drop) => {
          return sum + (DEVICE_REWARDS[drop.deviceType]?.reward || 2000000);
        }, 0);
        
        results.push({
          batch: Math.floor(i / batchSize) + 1,
          drops: batch.length,
          totalRewards: `${batchRewards / 1000000} tADA`,
          txHash,
          status: 'Success'
        });
        
        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 3000));
        
      } catch (error) {
        results.push({
          batch: Math.floor(i / batchSize) + 1,
          drops: batch.length,
          status: 'Failed',
          error: error.message
        });
      }
    }
    
    res.json({
      success: true,
      totalProcessed: pendingDrops.length,
      batches: results,
      network: "Cardano Testnet",
      message: "Batch processing completed!"
    });
    
  } catch (error) {
    console.error('Batch process error:', error);
    res.status(500).json({ 
      error: "Batch processing failed",
      details: error.message
    });
  }
}

// =============================================================================
// BLOCKCHAIN HELPERS - Testnet interactions
// =============================================================================

async function registerUserOnChain(userId, walletAddress) {
  const lucidInstance = await initializeLucid();
  
  const userDatum = Data.to({
    user_id: fromText(userId),
    wallet_address: fromText(walletAddress),
    total_earned: 0n,
    total_drops: 0n,
    created_timestamp: BigInt(Date.now()),
    last_activity: BigInt(Date.now())
  });
  
  const tx = await lucidInstance
    .newTx()
    .payToContract(CONTRACTS.USER_REGISTRY_ADDRESS, {
      inline: userDatum
    }, { lovelace: 2000000n }) // 2 tADA
    .complete();
    
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

async function submitDropOnChain(dropData) {
  const lucidInstance = await initializeLucid();
  
  const dropDatum = Data.to({
    bin_id: fromText(dropData.binId),
    photo_hash: fromText(dropData.photoHash),
    device_type: fromText(dropData.deviceType),
    environmental_risk: dropData.environmentalRisk,
    location: {
      latitude: BigInt(dropData.location.latitude),
      longitude: BigInt(dropData.location.longitude)
    },
    user_id: fromText(dropData.userId),
    user_wallet: fromText(dropData.userWallet),
    timestamp: BigInt(Date.now()),
    drop_id: fromText(dropData.dropId),
    reward_claimed: false,
    auto_distribute: dropData.autoDistribute
  });
  
  const tx = await lucidInstance
    .newTx()
    .payToContract(CONTRACTS.DROP_ADDRESS, {
      inline: dropDatum
    }, { lovelace: 2000000n })
    .complete();
    
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

async function batchDistributeRewards(dropIds) {
  const lucidInstance = await initializeLucid();
  
  // Get drop UTXOs (mock for now)
  const dropUTXOs = await getDropUTXOs(dropIds);
  
  const redeemer = Data.to({
    BatchDistribute: { 
      drop_ids: dropIds.map(id => fromText(id)) 
    }
  });
  
  const tx = await lucidInstance
    .newTx()
    .collectFrom(dropUTXOs, redeemer)
    .attachSpendingValidator(CONTRACTS.DROP_VALIDATOR)
    .complete();
    
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

// =============================================================================
// MOCK BLOCKCHAIN QUERIES (Replace with real Blockfrost queries)
// =============================================================================

async function getUserWalletFromChain(userId) {
  // Mock: In real implementation, query user registry contract
  return `addr_test1_user_${userId}_wallet`;
}

async function getUserStatsFromChain(userId) {
  // Mock: Query blockchain for user stats
  return {
    walletAddress: `addr_test1_user_${userId}_wallet`,
    fireblocksWalletId: `wallet_${userId}`,
    totalEarned: 10000000, // 10 tADA
    totalDrops: 3,
    pendingRewards: 4000000, // 4 tADA
    lastActivity: Date.now() - 86400000, // 1 day ago
    createdTimestamp: Date.now() - 604800000 // 1 week ago
  };
}

async function getUserRecentDrops(userId, limit) {
  // Mock: Query recent drops from blockchain
  return [
    {
      dropId: `drop_${userId}_1`,
      deviceType: 'smartphone',
      timestamp: Date.now() - 3600000, // 1 hour ago
      rewardClaimed: true
    },
    {
      dropId: `drop_${userId}_2`, 
      deviceType: 'laptop',
      timestamp: Date.now() - 7200000, // 2 hours ago
      rewardClaimed: false
    }
  ];
}

async function getPendingDropsFromChain() {
  // Mock: Query all pending drops
  return [
    { dropId: 'pending_drop_1', userId: 'user123', deviceType: 'smartphone' },
    { dropId: 'pending_drop_2', userId: 'user456', deviceType: 'laptop' },
    { dropId: 'pending_drop_3', userId: 'user789', deviceType: 'power_bank' }
  ];
}

async function getDropUTXOs(dropIds) {
  // Mock: Get UTXOs for drops (implement with Blockfrost)
  return []; // Placeholder
}

// =============================================================================
// SIMPLE HEALTH CHECK ENDPOINT
// =============================================================================
export async function healthCheck(req, res) {
  try {
    res.json({
      status: "healthy",
      network: "Cardano Testnet",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      endpoints: [
        "POST /api/register-user",
        "POST /api/submit-drop", 
        "GET /api/user-balance/:userId",
        "POST /api/batch-process",
        "GET /api/health"
      ]
    });
  } catch (error) {
    res.status(500).json({ error: "Health check failed" });
  }
}

// =============================================================================
// EXPORT FUNCTIONS FOR DEPLOYMENT
// =============================================================================
export {
  registerUser,    // POST /api/register-user
  submitDrop,      // POST /api/submit-drop
  getUserBalance,  // GET /api/user-balance/:userId
  batchProcess,    // POST /api/batch-process (admin)
  healthCheck      // GET /api/health
};

// =============================================================================
// DEPLOYMENT NOTES
// =============================================================================
/*
Environment Variables Required:
- FIREBLOCKS_API_KEY=your_fireblocks_api_key
- FIREBLOCKS_PRIVATE_KEY=your_fireblocks_private_key  
- BLOCKFROST_PROJECT_ID=your_testnet_project_id
- BACKEND_WALLET_SEED=your_cardano_testnet_wallet_seed
- ADMIN_TOKEN=simple_admin_auth_token
- DROP_CONTRACT_ADDRESS=addr_test1_your_drop_contract
- TREASURY_CONTRACT_ADDRESS=addr_test1_your_treasury
- USER_REGISTRY_ADDRESS=addr_test1_your_registry

Deploy as serverless functions:
1. Vercel: vercel.json with routes
2. Netlify: netlify.toml with functions
3. AWS Lambda: serverless.yml

No database required - all data stored on Cardano testnet!
*/