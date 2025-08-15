// RELOOP BACKEND - Complete E-waste Platform with Fireblocks Integration
import { Lucid, Blockfrost, Data, fromText, toHex, fromHex } from 'lucid-cardano';
import { FireblocksSDK } from 'fireblocks-sdk';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import sharp from 'sharp';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// Configure multer for photo uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// =============================================================================
// CONFIGURATION - MATCHES SMART CONTRACT WITH CONSOLIDATED WALLETS
// =============================================================================

const CONFIG = {
  CONTRACT_ADDRESS: process.env.RELOOP_CONTRACT_ADDRESS,
  CONTRACT_SCRIPT: process.env.RELOOP_CONTRACT_SCRIPT,
  
  // Fireblocks consolidated wallets for users
  CONSOLIDATED_WALLETS: {
    // These will be populated from Fireblocks when users sign up
    // 'user_001': 'addr1q9x2m3n4...',
    // 'user_002': 'addr1q7x8y9z0...',
    // ... more as volunteers join
  },
  
  // 25+ Device types with rewards (in lovelace)
  DEVICE_REWARDS: {
    // Cables & Chargers - 1 ADA
    'usb_cable': 1_000_000,
    'phone_charger': 1_000_000, 
    'laptop_charger': 1_000_000,
    'hdmi_cable': 1_000_000,
    'audio_cable': 1_000_000,
    
    // Small Electronics - 1.5 ADA
    'headphones': 1_500_000,
    'earbuds': 1_500_000,
    'bluetooth_speaker': 1_500_000,
    'computer_mouse': 1_500_000,
    'keyboard': 1_500_000,
    'remote_control': 1_500_000,
    'calculator': 1_500_000,
    
    // Medium Electronics - 3 ADA
    'smartphone': 3_000_000,
    'basic_phone': 3_000_000,
    'smartwatch': 3_000_000,
    'fitness_tracker': 3_000_000,
    'portable_speaker': 3_000_000,
    'gaming_controller': 3_000_000,
    
    // Large Electronics - 5 ADA
    'tablet': 5_000_000,
    'laptop': 5_000_000,
    'desktop_computer': 5_000_000,
    'monitor': 5_000_000,
    'printer': 5_000_000,
    
    // Batteries & Hazardous - 7 ADA
    'phone_battery': 7_000_000,
    'laptop_battery': 7_000_000,
    'power_bank': 7_000_000,
    'car_battery': 7_000_000,
    'ups_battery': 7_000_000,
  },
  
  // Nairobi area bounds for validation
  NAIROBI_BOUNDS: {
    minLat: -1.4,
    maxLat: -1.2, 
    minLng: 36.7,
    maxLng: 36.9
  }
};

// =============================================================================
// DATA SCHEMAS - MATCHING UPDATED AIKEN SMART CONTRACT
// =============================================================================

const LocationSchema = Data.Object({
  latitude: Data.Integer(),   // Multiplied by 1,000,000
  longitude: Data.Integer()
});

// Updated WalletInfo schema
const WalletInfoSchema = Data.Object({
  user_id: Data.Bytes(),
  consolidated_wallet: Data.Bytes(),
  individual_balance: Data.Integer(),
  total_earned: Data.Integer(),
  created_at: Data.Integer()
});

// Updated DropDatum schema with user_id
const DropDatum = Data.Object({
  drop_id: Data.Bytes(),
  user_id: Data.Bytes(),              // User ID instead of wallet directly
  user_wallet: Data.Bytes(),          // Consolidated wallet for this user
  bin_qr_code: Data.Bytes(),
  bin_location: LocationSchema,
  user_location: LocationSchema,
  device_type: Data.Bytes(),
  photo_hash: Data.Bytes(),
  reward_amount: Data.Integer(),
  timestamp: Data.Integer(),
  claimed: Data.Boolean(),
  batch_id: Data.Nullable(Data.Bytes()) // Optional batch ID
});

// UserReward schema for batch processing
const UserRewardSchema = Data.Object({
  user_id: Data.Bytes(),
  consolidated_wallet: Data.Bytes(),
  reward_amount: Data.Integer(),
  drop_count: Data.Integer()
});

// BatchDatum schema
const BatchDatum = Data.Object({
  batch_id: Data.Bytes(),
  user_rewards: Data.Array(UserRewardSchema),
  total_amount: Data.Integer(),
  processed: Data.Boolean(),
  created_at: Data.Integer()
});

const BinDatum = Data.Object({
  bin_id: Data.Bytes(),
  qr_code: Data.Bytes(),
  location: LocationSchema,
  bin_type: Data.Bytes(),
  active: Data.Boolean(),
  total_drops: Data.Integer()
});

// Updated ContractAction with new actions
const ContractAction = Data.Enum([
  Data.Object({ SubmitDrop: Data.Object({}) }),
  Data.Object({ ClaimReward: Data.Object({ user_id: Data.Bytes() }) }),
  Data.Object({ ProcessBatch: Data.Object({ batch_id: Data.Bytes() }) }),
  Data.Object({ RegisterWallet: Data.Object({ user_id: Data.Bytes() }) }),
  Data.Object({ RegisterBin: Data.Object({}) }),
  Data.Object({ DeactivateBin: Data.Object({ bin_id: Data.Bytes() }) })
]);

// =============================================================================
// FIREBLOCKS WALLET MANAGEMENT
// =============================================================================

class FireblocksManager {
  constructor() {
    this.fireblocks = new FireblocksSDK(
      fs.readFileSync(process.env.FIREBLOCKS_PRIVATE_KEY_PATH, 'utf8'),
      process.env.FIREBLOCKS_API_KEY
    );
  }

  async createUserWallet(userId, userEmail) {
    try {
      console.log(`Creating Fireblocks wallet for user: ${userId}`);
      
      const vaultAccount = await this.fireblocks.createVaultAccount({
        name: `RELOOP_${userId}`,
        customerRefId: userId
      });
      
      await this.fireblocks.createVaultAsset({
        vaultAccountId: vaultAccount.id,
        assetId: 'ADA'
      });
      
      const addresses = await this.fireblocks.getDepositAddresses({
        vaultAccountId: vaultAccount.id,
        assetId: 'ADA'
      });
      
      return {
        userId,
        cardanoAddress: addresses[0]?.address,
        vaultId: vaultAccount.id
      };
      
    } catch (error) {
      throw new Error(`Fireblocks wallet creation failed: ${error.message}`);
    }
  }
}

// Initialize managers
const fireblocksManager = new FireblocksManager();
const userWallets = new Map(); // userId -> { cardanoAddress, vaultId, email }

// =============================================================================
// LUCID INITIALIZATION
// =============================================================================

let lucid;
async function initializeLucid() {
  if (!lucid) {
    lucid = await Lucid.new(
      new Blockfrost(
        "https://cardano-preprod.blockfrost.io/api/v0",
        process.env.BLOCKFROST_PROJECT_ID
      ),
      "Preprod"
    );
    lucid.selectWalletFromSeed(process.env.BACKEND_WALLET_SEED);
  }
  return lucid;
}

// =============================================================================
// CONSOLIDATED WALLET MANAGEMENT - UPDATED WITH FIREBLOCKS
// =============================================================================

// Register new user with Fireblocks wallet
app.post('/api/users/register', async (req, res) => {
  try {
    const { userId, email } = req.body;
    
    if (!userId || !email) {
      return res.status(400).json({ error: "User ID and email required" });
    }
    
    // Check if user already exists
    if (userWallets.has(userId)) {
      const existing = userWallets.get(userId);
      return res.status(400).json({ 
        error: "User already registered",
        wallet: existing.cardanoAddress
      });
    }
    
    console.log(`Registering new user: ${userId} (${email})`);
    
    // Create Fireblocks wallet for user
    const walletInfo = await fireblocksManager.createUserWallet(userId, email);
    
    // Store user info locally
    userWallets.set(userId, {
      cardanoAddress: walletInfo.cardanoAddress,
      vaultId: walletInfo.vaultId,
      email,
      createdAt: new Date()
    });
    
    // Register wallet in smart contract
    const txHash = await registerWalletInContract({
      userId,
      consolidatedWallet: walletInfo.cardanoAddress
    });
    
    // Store in config for quick access
    CONFIG.CONSOLIDATED_WALLETS[userId] = walletInfo.cardanoAddress;
    
    res.json({
      success: true,
      user: {
        userId,
        email,
        cardanoAddress: walletInfo.cardanoAddress,
        vaultId: walletInfo.vaultId
      },
      blockchain: {
        transactionHash: txHash,
        contractAddress: CONFIG.CONTRACT_ADDRESS
      },
      message: "User registered successfully with Fireblocks wallet!"
    });
    
  } catch (error) {
    console.error('Enhanced registration error:', error);
    res.status(500).json({ 
      error: error.message,
      details: "Failed to create Fireblocks wallet for user"
    });
  }
});

// Get user wallet info and balance  
app.get('/api/users/:userId/wallet', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get from local storage
    const user = userWallets.get(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    // Get smart contract wallet info
    const contractWallet = await findWalletInContract(userId);
    
    res.json({
      success: true,
      user: {
        userId,
        email: user.email,
        cardanoAddress: user.cardanoAddress,
        vaultId: user.vaultId
      },
      balances: {
        smartContract: contractWallet ? {
          pending: `${contractWallet.individual_balance / 1_000_000} ADA`,
          totalEarned: `${contractWallet.total_earned / 1_000_000} ADA`
        } : null
      },
      createdAt: user.createdAt
    });
    
  } catch (error) {
    console.error('Wallet info error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Claim pending rewards for user
app.post('/api/users/:userId/claim', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const walletInfo = await findWalletInContract(userId);
    if (!walletInfo) {
      return res.status(404).json({ error: "User wallet not found" });
    }
    
    if (walletInfo.individual_balance <= 0) {
      return res.status(400).json({ error: "No pending rewards to claim" });
    }
    
    // Claim rewards from smart contract
    const txHash = await claimWalletRewards(userId);
    
    res.json({
      success: true,
      userId,
      claimedAmount: `${walletInfo.individual_balance / 1_000_000} ADA`,
      transactionHash: txHash,
      message: "Rewards claimed successfully!"
    });
    
  } catch (error) {
    console.error('Reward claim error:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// BATCH PROCESSING ENDPOINTS
// =============================================================================

// Process batch rewards for multiple users
app.post('/api/batch/process', async (req, res) => {
  try {
    const { userIds, minBalance = 1000000 } = req.body; // Default min 1 ADA
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "User IDs array required" });
    }
    
    if (userIds.length > 50) {
      return res.status(400).json({ error: "Maximum 50 users per batch" });
    }
    
    // Get all user wallets and filter by minimum balance
    const userRewards = [];
    let totalAmount = 0;
    
    for (const userId of userIds) {
      const walletInfo = await findWalletInContract(userId);
      if (walletInfo && walletInfo.individual_balance >= minBalance) {
        userRewards.push({
          user_id: userId,
          consolidated_wallet: walletInfo.consolidated_wallet,
          reward_amount: walletInfo.individual_balance,
          drop_count: Math.floor(walletInfo.individual_balance / 1000000) // Estimate drops
        });
        totalAmount += Number(walletInfo.individual_balance);
      }
    }
    
    if (userRewards.length === 0) {
      return res.status(400).json({ 
        error: `No users found with minimum balance of ${minBalance / 1_000_000} ADA` 
      });
    }
    
    // Create batch and process
    const batchId = crypto.randomBytes(16).toString('hex');
    const txHash = await processBatchRewards({
      batchId,
      userRewards,
      totalAmount
    });
    
    res.json({
      success: true,
      batchId,
      processedUsers: userRewards.length,
      totalAmount: `${totalAmount / 1_000_000} ADA`,
      transactionHash: txHash,
      message: "Batch processing completed successfully"
    });
    
  } catch (error) {
    console.error('Batch processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get batch processing history
app.get('/api/batch/history', async (req, res) => {
  try {
    const batches = await getBatchHistory();
    
    res.json({
      success: true,
      batches,
      totalBatches: batches.length
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// UPDATED DROP SUBMISSION (with user_id and Fireblocks integration)
// =============================================================================

// Submit e-waste drop (updated for consolidated wallets)
app.post('/api/drops/submit', upload.single('photo'), async (req, res) => {
  try {
    const {
      userId,
      binQrCode,
      binLocation,
      userLocation, 
      deviceType
    } = req.body;
    
    // Parse locations
    const parsedBinLocation = JSON.parse(binLocation);
    const parsedUserLocation = JSON.parse(userLocation);
    
    // Validate inputs
    if (!req.file) {
      return res.status(400).json({ error: "Photo is required" });
    }
    
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }
    
    if (!CONFIG.DEVICE_REWARDS[deviceType]) {
      return res.status(400).json({ 
        error: "Invalid device type",
        validDevices: Object.keys(CONFIG.DEVICE_REWARDS)
      });
    }
    
    // Validate user exists
    const user = userWallets.get(userId);
    if (!user) {
      return res.status(400).json({ error: "User not registered. Please register first." });
    }
    
    // Validate locations
    if (!isValidLocation(parsedBinLocation) || !isValidLocation(parsedUserLocation)) {
      return res.status(400).json({ error: "Invalid location coordinates" });
    }
    
    // Check if user is near bin (within 100m)
    if (!isUserNearBin(parsedUserLocation, parsedBinLocation)) {
      return res.status(400).json({ 
        error: "You must be within 100m of the bin to make a drop" 
      });
    }
    
    // Verify bin exists and is active
    const binExists = await verifyBinExists(binQrCode, parsedBinLocation);
    if (!binExists) {
      return res.status(400).json({ error: "Bin not found or inactive" });
    }
    
    // Process photo and create hash
    const photoHash = await processPhoto(req.file);
    
    // Generate unique drop ID
    const dropId = crypto.randomBytes(16).toString('hex');
    const rewardAmount = CONFIG.DEVICE_REWARDS[deviceType];
    
    // Submit to smart contract with user_id
    const txHash = await submitDropToContract({
      dropId,
      userId,
      userWallet: user.cardanoAddress,
      binQrCode,
      binLocation: parsedBinLocation,
      userLocation: parsedUserLocation,
      deviceType,
      photoHash,
      rewardAmount
    });
    
    res.json({
      success: true,
      dropId,
      userId,
      reward: `${rewardAmount / 1_000_000} ADA`,
      deviceType,
      binQrCode,
      transactionHash: txHash,
      message: "Drop submitted successfully! Reward added to your balance."
    });
    
  } catch (error) {
    console.error('Drop submission error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get drop history for user (updated for user_id)
app.get('/api/drops/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const drops = await getUserDropHistory(userId);
    
    const totalRewards = drops.reduce((sum, drop) => sum + drop.reward_amount, 0);
    const claimedRewards = drops.filter(d => d.claimed).reduce((sum, drop) => sum + drop.reward_amount, 0);
    const pendingRewards = totalRewards - claimedRewards;
    
    res.json({
      success: true,
      drops,
      totalDrops: drops.length,
      totalRewards: `${totalRewards / 1_000_000} ADA`,
      claimedRewards: `${claimedRewards / 1_000_000} ADA`,
      pendingRewards: `${pendingRewards / 1_000_000} ADA`,
      userId
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// BIN MANAGEMENT (unchanged)
// =============================================================================

app.post('/api/bins/register', async (req, res) => {
  try {
    const { binId, location, binType = 'standard' } = req.body;
    
    const qrCode = `RELOOP_BIN_${binId}_${Date.now()}`;
    
    if (!isValidLocation(location)) {
      return res.status(400).json({ error: "Invalid location coordinates" });
    }
    
    const txHash = await registerBinInContract({
      binId,
      qrCode,
      location,
      binType
    });
    
    res.json({
      success: true,
      binId,
      qrCode,
      location,
      transactionHash: txHash,
      message: "Bin registered successfully"
    });
    
  } catch (error) {
    console.error('Bin registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bins/active', async (req, res) => {
  try {
    const activeBins = await getActiveBinsFromContract();
    res.json({
      success: true,
      bins: activeBins,
      count: activeBins.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bins/nearest', async (req, res) => {
  try {
    const { lat, lng, radius = 5 } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ error: "Latitude and longitude required" });
    }
    
    const userLocation = { latitude: parseFloat(lat), longitude: parseFloat(lng) };
    const nearestBins = await findNearestBins(userLocation, parseFloat(radius));
    
    res.json({
      success: true,
      bins: nearestBins,
      userLocation: userLocation
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// UPDATED SMART CONTRACT INTERACTION FUNCTIONS
// =============================================================================

async function registerWalletInContract(walletData) {
  const lucidInstance = await initializeLucid();
  
  const walletDatum = Data.to({
    user_id: fromText(walletData.userId),
    consolidated_wallet: fromText(walletData.consolidatedWallet),
    individual_balance: 0n,
    total_earned: 0n,
    created_at: BigInt(Date.now())
  }, WalletInfoSchema);
  
  const redeemer = Data.to({ 
    RegisterWallet: { user_id: fromText(walletData.userId) } 
  }, ContractAction);
  
  const tx = await lucidInstance
    .newTx()
    .payToContract(CONFIG.CONTRACT_ADDRESS, {
      inline: walletDatum
    }, { lovelace: 2_000_000n })
    .attachSpendingValidator({
      type: "PlutusV2",
      script: CONFIG.CONTRACT_SCRIPT
    })
    .complete();
    
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

async function submitDropToContract(dropData) {
  const lucidInstance = await initializeLucid();
  
  const dropDatum = Data.to({
    drop_id: fromText(dropData.dropId),
    user_id: fromText(dropData.userId),
    user_wallet: fromText(dropData.userWallet),
    bin_qr_code: fromText(dropData.binQrCode),
    bin_location: {
      latitude: BigInt(Math.round(dropData.binLocation.latitude * 1_000_000)),
      longitude: BigInt(Math.round(dropData.binLocation.longitude * 1_000_000))
    },
    user_location: {
      latitude: BigInt(Math.round(dropData.userLocation.latitude * 1_000_000)),
      longitude: BigInt(Math.round(dropData.userLocation.longitude * 1_000_000))
    },
    device_type: fromText(dropData.deviceType),
    photo_hash: dropData.photoHash,
    reward_amount: BigInt(dropData.rewardAmount),
    timestamp: BigInt(Date.now()),
    claimed: false,
    batch_id: null
  }, DropDatum);
  
  const redeemer = Data.to({ SubmitDrop: {} }, ContractAction);
  
  // Get bin UTXO and user wallet UTXO
  const binUTXO = await findBinUTXO(dropData.binQrCode);
  const walletUTXO = await findWalletUTXO(dropData.userId);
  
  const tx = await lucidInstance
    .newTx()
    .payToContract(CONFIG.CONTRACT_ADDRESS, {
      inline: dropDatum
    }, { lovelace: 2_000_000n })
    .collectFrom([binUTXO, walletUTXO], redeemer)
    .attachSpendingValidator({
      type: "PlutusV2",
      script: CONFIG.CONTRACT_SCRIPT
    })
    .complete();
    
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

async function claimWalletRewards(userId) {
  const lucidInstance = await initializeLucid();
  
  const walletUTXO = await findWalletUTXO(userId);
  if (!walletUTXO) {
    throw new Error("User wallet not found in contract");
  }
  
  const redeemer = Data.to({ 
    ClaimReward: { user_id: fromText(userId) } 
  }, ContractAction);
  
  const tx = await lucidInstance
    .newTx()
    .collectFrom([walletUTXO], redeemer)
    .attachSpendingValidator({
      type: "PlutusV2", 
      script: CONFIG.CONTRACT_SCRIPT
    })
    .complete();
    
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

async function processBatchRewards(batchData) {
  const lucidInstance = await initializeLucid();
  
  const batchDatum = Data.to({
    batch_id: fromText(batchData.batchId),
    user_rewards: batchData.userRewards.map(ur => ({
      user_id: fromText(ur.user_id),
      consolidated_wallet: fromText(ur.consolidated_wallet),
      reward_amount: BigInt(ur.reward_amount),
      drop_count: BigInt(ur.drop_count)
    })),
    total_amount: BigInt(batchData.totalAmount),
    processed: false,
    created_at: BigInt(Date.now())
  }, BatchDatum);
  
  const redeemer = Data.to({ 
    ProcessBatch: { batch_id: fromText(batchData.batchId) } 
  }, ContractAction);
  
  const tx = await lucidInstance
    .newTx()
    .payToContract(CONFIG.CONTRACT_ADDRESS, {
      inline: batchDatum
    }, { lovelace: 2_000_000n })
    .attachSpendingValidator({
      type: "PlutusV2",
      script: CONFIG.CONTRACT_SCRIPT
    })
    .complete();
    
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

async function registerBinInContract(binData) {
  const lucidInstance = await initializeLucid();
  
  const binDatum = Data.to({
    bin_id: fromText(binData.binId),
    qr_code: fromText(binData.qrCode),
    location: {
      latitude: BigInt(Math.round(binData.location.latitude * 1_000_000)),
      longitude: BigInt(Math.round(binData.location.longitude * 1_000_000))
    },
    bin_type: fromText(binData.binType),
    active: true,
    total_drops: 0n
  }, BinDatum);
  
  const redeemer = Data.to({ RegisterBin: {} }, ContractAction);
  
  const tx = await lucidInstance
    .newTx()
    .payToContract(CONFIG.CONTRACT_ADDRESS, {
      inline: binDatum
    }, { lovelace: 2_000_000n })
    .attachSpendingValidator({
      type: "PlutusV2",
      script: CONFIG.CONTRACT_SCRIPT
    })
    .complete();
    
  const signedTx = await tx.sign().complete();
  return await signedTx.submit();
}

// =============================================================================
// UPDATED BLOCKCHAIN QUERY FUNCTIONS
// =============================================================================

async function findWalletInContract(userId) {
  const response = await fetch(
    `https://cardano-preprod.blockfrost.io/api/v0/addresses/${CONFIG.CONTRACT_ADDRESS}/utxos`,
    { headers: { 'project_id': process.env.BLOCKFROST_PROJECT_ID } }
  );
  
  const utxos = await response.json();
  
  for (const utxo of utxos) {
    if (utxo.inline_datum) {
      try {
        const datum = Data.from(utxo.inline_datum, WalletInfoSchema);
        const storedUserId = Buffer.from(datum.user_id, 'hex').toString('utf8');
        
        if (storedUserId === userId) {
          return {
            user_id: storedUserId,
            consolidated_wallet: Buffer.from(datum.consolidated_wallet, 'hex').toString('utf8'),
            individual_balance: Number(datum.individual_balance),
            total_earned: Number(datum.total_earned),
            created_at: Number(datum.created_at)
          };
        }
      } catch (e) {
        continue;
      }
    }
  }
  
  return null;
}

async function findWalletUTXO(userId) {
  const response = await fetch(
    `https://cardano-preprod.blockfrost.io/api/v0/addresses/${CONFIG.CONTRACT_ADDRESS}/utxos`,
    { headers: { 'project_id': process.env.BLOCKFROST_PROJECT_ID } }
  );
  
  const utxos = await response.json();
  
  for (const utxo of utxos) {
    if (utxo.inline_datum) {
      try {
        const datum = Data.from(utxo.inline_datum, WalletInfoSchema);
        const storedUserId = Buffer.from(datum.user_id, 'hex').toString('utf8');
        
        if (storedUserId === userId) {
          return utxo;
        }
      } catch (e) {
        continue;
      }
    }
  }
  
  return null;
}

async function getBatchHistory() {
  const response = await fetch(
    `https://cardano-preprod.blockfrost.io/api/v0/addresses/${CONFIG.CONTRACT_ADDRESS}/utxos`,
    { headers: { 'project_id': process.env.BLOCKFROST_PROJECT_ID } }
  );
  
  const utxos = await response.json();
  const batches = [];
  
  for (const utxo of utxos) {
    if (utxo.inline_datum) {
      try {
        const datum = Data.from(utxo.inline_datum, BatchDatum);
        batches.push({
          batch_id: Buffer.from(datum.batch_id, 'hex').toString('utf8'),
          user_count: datum.user_rewards.length,
          total_amount: Number(datum.total_amount) / 1_000_000,
          processed: datum.processed,
          created_at: new Date(Number(datum.created_at)).toISOString()
        });
      } catch (e) {
        continue;
      }
    }
  }
  
  return batches.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function getUserDropHistory(userId) {
  const response = await fetch(
    `https://cardano-preprod.blockfrost.io/api/v0/addresses/${CONFIG.CONTRACT_ADDRESS}/utxos`,
    { headers: { 'project_id': process.env.BLOCKFROST_PROJECT_ID } }
  );
  
  const utxos = await response.json();
  const userDrops = [];
  
  for (const utxo of utxos) {
    if (utxo.inline_datum) {
      try {
        const datum = Data.from(utxo.inline_datum, DropDatum);
        const storedUserId = Buffer.from(datum.user_id, 'hex').toString('utf8');
        
        if (storedUserId === userId) {
          userDrops.push({
            drop_id: Buffer.from(datum.drop_id, 'hex').toString('utf8'),
            device_type: Buffer.from(datum.device_type, 'hex').toString('utf8'),
            reward_amount: Number(datum.reward_amount),
            claimed: datum.claimed,
            timestamp: Number(datum.timestamp)
          });
        }
      } catch (e) {
        continue;
      }
    }
  }
  
  return userDrops.sort((a, b) => b.timestamp - a.timestamp);
}

async function getActiveBinsFromContract() {
  const response = await fetch(
    `https://cardano-preprod.blockfrost.io/api/v0/addresses/${CONFIG.CONTRACT_ADDRESS}/utxos`,
    { headers: { 'project_id': process.env.BLOCKFROST_PROJECT_ID } }
  );
  
  const utxos = await response.json();
  const bins = [];
  
  for (const utxo of utxos) {
    if (utxo.inline_datum) {
      try {
        const datum = Data.from(utxo.inline_datum, BinDatum);
        if (datum.active) {
          bins.push({
            binId: Buffer.from(datum.bin_id, 'hex').toString('utf8'),
            qrCode: Buffer.from(datum.qr_code, 'hex').toString('utf8'),
            location: {
              latitude: Number(datum.location.latitude) / 1_000_000,
              longitude: Number(datum.location.longitude) / 1_000_000
            },
            binType: Buffer.from(datum.bin_type, 'hex').toString('utf8'),
            totalDrops: Number(datum.total_drops)
          });
        }
      } catch (e) {
        continue;
      }
    }
  }
  
  return bins;
}

async function findBinUTXO(qrCode) {
  const response = await fetch(
    `https://cardano-preprod.blockfrost.io/api/v0/addresses/${CONFIG.CONTRACT_ADDRESS}/utxos`,
    { headers: { 'project_id': process.env.BLOCKFROST_PROJECT_ID } }
  );
  
  const utxos = await response.json();
  
  for (const utxo of utxos) {
    if (utxo.inline_datum) {
      try {
        const datum = Data.from(utxo.inline_datum, BinDatum);
        const storedQrCode = Buffer.from(datum.qr_code, 'hex').toString('utf8');
        
        if (storedQrCode === qrCode) {
          return utxo;
        }
      } catch (e) {
        continue;
      }
    }
  }
  
  return null;
}

// =============================================================================
// HELPER FUNCTIONS (mostly unchanged)
// =============================================================================

async function processPhoto(photoFile) {
  // Resize and optimize photo
  const processedPhoto = await sharp(photoFile.buffer)
    .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  
  // Create SHA-256 hash
  const hash = crypto.createHash('sha256').update(processedPhoto).digest();
  return new Uint8Array(hash);
}

function isValidLocation(location) {
  return (
    location &&
    typeof location.latitude === 'number' &&
    typeof location.longitude === 'number' &&
    location.latitude >= -90 && location.latitude <= 90 &&
    location.longitude >= -180 && location.longitude <= 180
  );
}

function isUserNearBin(userLoc, binLoc) {
  // Calculate distance using simplified formula
  const latDiff = Math.abs(userLoc.latitude - binLoc.latitude);
  const lngDiff = Math.abs(userLoc.longitude - binLoc.longitude);
  
  // Approximately 0.001 degrees = ~111m at equator
  const maxDiff = 0.001; // ~100m
  
  return latDiff <= maxDiff && lngDiff <= maxDiff;
}

async function verifyBinExists(qrCode, location) {
  const activeBins = await getActiveBinsFromContract();
  
  return activeBins.some(bin => 
    bin.qrCode === qrCode &&
    Math.abs(bin.location.latitude - location.latitude) < 0.0001 &&
    Math.abs(bin.location.longitude - location.longitude) < 0.0001
  );
}

async function findNearestBins(userLocation, radiusKm) {
  const activeBins = await getActiveBinsFromContract();
  
  return activeBins
    .map(bin => ({
      ...bin,
      distance: calculateDistance(userLocation, bin.location)
    }))
    .filter(bin => bin.distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance);
}

function calculateDistance(loc1, loc2) {
  // Haversine formula for distance calculation
  const R = 6371; // Earth's radius in km
  const dLat = (loc2.latitude - loc1.latitude) * Math.PI / 180;
  const dLon = (loc2.longitude - loc1.longitude) * Math.PI / 180;
  
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(loc1.latitude * Math.PI / 180) * Math.cos(loc2.latitude * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// =============================================================================
// INFO AND ADMIN ENDPOINTS
// =============================================================================

// Get device types and rewards
app.get('/api/info/devices', (req, res) => {
  const deviceCategories = {
    'Cables & Chargers (1 ADA)': [
      'usb_cable', 'phone_charger', 'laptop_charger', 'hdmi_cable', 'audio_cable'
    ],
    'Small Electronics (1.5 ADA)': [
      'headphones', 'earbuds', 'bluetooth_speaker', 'computer_mouse', 'keyboard', 'remote_control', 'calculator'
    ],
    'Medium Electronics (3 ADA)': [
      'smartphone', 'basic_phone', 'smartwatch', 'fitness_tracker', 'portable_speaker', 'gaming_controller'
    ],
    'Large Electronics (5 ADA)': [
      'tablet', 'laptop', 'desktop_computer', 'monitor', 'printer'
    ],
    'Batteries & Hazardous (7 ADA)': [
      'phone_battery', 'laptop_battery', 'power_bank', 'car_battery', 'ups_battery'
    ]
  };
  
  res.json({
    success: true,
    deviceCategories,
    rewardMapping: CONFIG.DEVICE_REWARDS,
    totalDeviceTypes: Object.keys(CONFIG.DEVICE_REWARDS).length
  });
});

// Get all registered users (admin) - UPDATED WITH FIREBLOCKS
app.get('/api/admin/users', async (req, res) => {
  try {
    // Get users from local storage
    const users = Array.from(userWallets.entries()).map(([userId, userData]) => ({
      userId,
      email: userData.email,
      cardanoAddress: userData.cardanoAddress,
      vaultId: userData.vaultId,
      createdAt: userData.createdAt
    }));
    
    // Enhance with smart contract data
    const enhancedUsers = [];
    for (const user of users) {
      const contractWallet = await findWalletInContract(user.userId);
      enhancedUsers.push({
        ...user,
        contractBalance: contractWallet ? {
          pending: contractWallet.individual_balance / 1_000_000,
          totalEarned: contractWallet.total_earned / 1_000_000
        } : null
      });
    }
    
    res.json({
      success: true,
      users: enhancedUsers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      summary: {
        totalUsers: users.length,
        totalPendingRewards: enhancedUsers.reduce((sum, u) => 
          sum + (u.contractBalance ? u.contractBalance.pending : 0), 0
        ),
        totalEarnedRewards: enhancedUsers.reduce((sum, u) => 
          sum + (u.contractBalance ? u.contractBalance.totalEarned : 0), 0
        )
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get platform statistics
app.get('/api/stats', async (req, res) => {
  try {
    const [users, bins, batches] = await Promise.all([
      getAllUsers(),
      getActiveBinsFromContract(), 
      getBatchHistory()
    ]);
    
    // Calculate total drops from all users
    let totalDrops = 0;
    let totalRewards = 0;
    
    for (const user of users) {
      const userDrops = await getUserDropHistory(user.userId);
      totalDrops += userDrops.length;
      totalRewards += userDrops.reduce((sum, drop) => sum + drop.reward_amount, 0);
    }
    
    res.json({
      success: true,
      platform: {
        totalUsers: users.length,
        totalBins: bins.length,
        totalDrops,
        totalRewardsDistributed: `${totalRewards / 1_000_000} ADA`,
        totalBatches: batches.length,
        activeBins: bins.filter(b => b.active).length
      },
      recentActivity: {
        newUsersToday: users.filter(u => 
          new Date(u.createdAt) > new Date(Date.now() - 24 * 60 * 60 * 1000)
        ).length,
        processingBatches: batches.filter(b => !b.processed).length
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function getAllUsers() {
  const response = await fetch(
    `https://cardano-preprod.blockfrost.io/api/v0/addresses/${CONFIG.CONTRACT_ADDRESS}/utxos`,
    { headers: { 'project_id': process.env.BLOCKFROST_PROJECT_ID } }
  );
  
  const utxos = await response.json();
  const users = [];
  
  for (const utxo of utxos) {
    if (utxo.inline_datum) {
      try {
        const datum = Data.from(utxo.inline_datum, WalletInfoSchema);
        users.push({
          userId: Buffer.from(datum.user_id, 'hex').toString('utf8'),
          consolidatedWallet: Buffer.from(datum.consolidated_wallet, 'hex').toString('utf8'),
          pendingBalance: Number(datum.individual_balance),
          totalEarned: Number(datum.total_earned),
          createdAt: new Date(Number(datum.created_at)).toISOString()
        });
      } catch (e) {
        continue;
      }
    }
  }
  
  return users;
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: "Reloop backend is running with Fireblocks integration",
    contractAddress: CONFIG.CONTRACT_ADDRESS ? 'configured' : 'missing',
    consolidatedWallets: Object.keys(CONFIG.CONSOLIDATED_WALLETS).length,
    fireblocksIntegration: process.env.FIREBLOCKS_API_KEY ? 'configured' : 'missing',
    timestamp: new Date().toISOString()
  });
});

// =============================================================================
// SERVER STARTUP
// =============================================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Reloop backend running on port ${PORT}`);
  console.log(`📄 Contract address: ${CONFIG.CONTRACT_ADDRESS ? 'configured' : 'MISSING'}`);
  console.log(`💰 Consolidated wallets: ${Object.keys(CONFIG.CONSOLIDATED_WALLETS).length}`);
  console.log(`🔥 Fireblocks: ${process.env.FIREBLOCKS_API_KEY ? 'configured' : 'MISSING'}`);
  console.log(`📱 Device types supported: ${Object.keys(CONFIG.DEVICE_REWARDS).length}`);
  console.log(`\n🔗 API Endpoints:`);
  console.log(`   POST /api/users/register - Register user with Fireblocks wallet`);
  console.log(`   GET  /api/users/:userId/wallet - Get user wallet info`);
  console.log(`   POST /api/users/:userId/claim - Claim pending rewards`);
  console.log(`   POST /api/batch/process - Process batch rewards`);
  console.log(`   GET  /api/batch/history - Get batch history`);
  console.log(`   POST /api/bins/register - Register new bin`);
  console.log(`   GET  /api/bins/active - Get active bins`);
  console.log(`   GET  /api/bins/nearest - Find nearest bins`);
  console.log(`   POST /api/drops/submit - Submit e-waste drop (with userId)`);
  console.log(`   GET  /api/drops/history/:userId - Get user drop history`);
  console.log(`   GET  /api/info/devices - Get device types`);
  console.log(`   GET  /api/admin/users - Get all users (admin)`);
  console.log(`   GET  /api/stats - Get platform statistics`);
  console.log(`\n🎯 NEW FLOW WITH FIREBLOCKS:`);
  console.log(`   1. User calls POST /api/users/register with { userId: "user123", email: "user@email.com" }`);
  console.log(`   2. Backend creates Fireblocks wallet and registers address in smart contract`);
  console.log(`   3. User submits e-waste drop`);
  console.log(`   4. Smart contract validates and sends ADA directly to user's Fireblocks wallet`);
  console.log(`   5. User checks balance in Fireblocks app or via GET /api/users/user123/wallet`);
});

export default app;