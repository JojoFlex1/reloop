// RELOOP Minimal Backend - Just 4 endpoints!
// Deploy this on Vercel/Netlify Functions - Zero server management

import { Fireblocks } from '@fireblocks/sdk';
import { Lucid, Blockfrost } from 'lucid-cardano';

// Initialize Fireblocks (your custodial wallet provider)
const fireblocks = new Fireblocks({
  apiKey: process.env.FIREBLOCKS_API_KEY,
  privateKey: process.env.FIREBLOCKS_PRIVATE_KEY
});

// Initialize Lucid for Cardano
const lucid = await Lucid.new(
  new Blockfrost(process.env.BLOCKFROST_URL, process.env.BLOCKFROST_KEY),
  "Mainnet"
);

// =============================================================================
// 1. REGISTER USER - Creates custodial wallet
// =============================================================================
export async function registerUser(req, res) {
  try {
    const { email, name } = req.body;
    
    // Create unique user ID from email
    const userId = hashEmail(email);
    
    // Create custodial wallet via Fireblocks
    const wallet = await fireblocks.createWallet({
      name: `RELOOP-${name}`,
      customerRefId: userId
    });
    
    // Get Cardano address
    const address = await fireblocks.generateAddress(wallet.id, 'ADA');
    
    // Register user in smart contract
    await registerUserOnChain(userId, address.address);
    
    res.json({
      success: true,
      userId: userId,
      walletAddress: address.address,
      message: "User registered successfully!"
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// =============================================================================
// 4. BATCH PROCESS - Admin processes pending rewards
// =============================================================================
export async function batchProcess(req, res) {
  try {
    // Get all pending drops from blockchain
    const pendingDrops = await getPendingDropsFromChain();
    
    if (pendingDrops.length === 0) {
      return res.json({ message: "No pending drops to process" });
    }
    
    // Process in batches of 10 (Cardano transaction limits)
    const batchSize = 10;
    const results = [];
    
    for (let i = 0; i < pendingDrops.length; i += batchSize) {
      const batch = pendingDrops.slice(i, i + batchSize);
      const dropIds = batch.map(drop => drop.dropId);
      
      // Submit batch distribution transaction
      const txHash = await batchDistributeRewards(dropIds);
      
      results.push({
        batch: i / batchSize + 1,
        dropsProcessed: batch.length,
        transactionHash: txHash
      });
    }
    
    res.json({
      success: true,
      totalDropsProcessed: pendingDrops.length,
      batches: results,
      message: "All pending rewards distributed!"
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// =============================================================================
// HELPER FUNCTIONS - The actual blockchain interaction
// =============================================================================

async function registerUserOnChain(userId, walletAddress) {
  // Build transaction to register user in smart contract
  const tx = await lucid
    .newTx()
    .payToContract(CONTRACT_ADDRESS, {
      inline: Data.to({
        user_id: userId,
        wallet_address: walletAddress,
        total_earned: 0,
        total_drops: 0,
        created_timestamp: Date.now(),
        last_activity: Date.now()
      })
    }, { lovelace: 2000000n }) // 2 ADA minimum
    .complete();
    
  // Sign with backend key via Fireblocks
  const signedTx = await signWithFireblocks(tx);
  return await signedTx.submit();
}

async function submitDropOnChain(dropData) {
  // Build transaction to submit drop
  const tx = await lucid
    .newTx()
    .payToContract(CONTRACT_ADDRESS, {
      inline: Data.to({
        bin_id: dropData.binId,
        photo_hash: dropData.photoHash,
        device_type: dropData.deviceType,
        environmental_risk: dropData.environmentalRisk,
        location: dropData.location,
        user_id: dropData.userId,
        user_wallet: await getUserWallet(dropData.userId),
        timestamp: Date.now(),
        drop_id: dropData.dropId,
        reward_claimed: false,
        auto_distribute: dropData.autoDistribute
      })
    }, { lovelace: 2000000n })
    .complete();
    
  const signedTx = await signWithFireblocks(tx);
  return await signedTx.submit();
}

async function batchDistributeRewards(dropIds) {
  // Build batch distribution transaction
  const tx = await lucid
    .newTx()
    .collectFrom(await getDropUTXOs(dropIds))
    .attachSpendingValidator(DROP_VALIDATOR)
    .addSigner(BACKEND_ADDRESS)
    .complete();
    
  const signedTx = await signWithFireblocks(tx);
  return await signedTx.submit();
}

async function signWithFireblocks(tx) {
  // Sign transaction using Fireblocks custodial service
  const txHex = tx.toString();
  
  const signedTxHex = await fireblocks.signTransaction({
    txData: txHex,
    walletId: BACKEND_WALLET_ID,
    assetId: 'ADA'
  });
  
  return lucid.fromTx(signedTxHex);
}

// =============================================================================
// UTILITY FUNCTIONS - Super simple helpers
// =============================================================================

function hashEmail(email) {
  // Create deterministic user ID from email
  return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
}

function getEnvironmentalRisk(deviceType) {
  const riskMap = {
    'usb_cable': 'Safe',
    'phone_charger': 'Safe',
    'smartphone': 'MediumRisk',
    'laptop': 'HighRisk',
    'power_bank': 'VeryHighRisk',
    'laptop_battery': 'VeryHighRisk'
  };
  return riskMap[deviceType] || 'Safe';
}

function calculateReward(environmentalRisk) {
  const baseReward = 2; // 2 ADA base
  const multipliers = {
    'Safe': 1,
    'LowRisk': 1, 
    'MediumRisk': 2,
    'HighRisk': 2,
    'VeryHighRisk': 3
  };
  return baseReward * (multipliers[environmentalRisk] || 1);
}

function generateDropId() {
  return crypto.randomBytes(16).toString('hex');
}

async function uploadToIPFS(photoFile) {
  // Upload to IPFS (use Pinata or similar service)
  // This is a placeholder - implement based on your IPFS provider
  return "QmExampleHashForUserPhoto123";
}

async function getUserWallet(userId) {
  // Get user's custodial wallet address from blockchain or database
  // This queries the user registry contract
  return "addr1_example_custodial_wallet_address";
}

async function getUserStatsFromChain(userId) {
  // Query blockchain for user's stats
  return {
    totalEarned: 10000000, // 10 ADA in lovelace
    totalDrops: 5,
    pendingRewards: 2000000 // 2 ADA in lovelace
  };
}

async function getPendingDropsFromChain() {
  // Query blockchain for unprocessed drops
  return [
    { dropId: "drop123", userId: "user456", deviceType: "smartphone" },
    { dropId: "drop124", userId: "user789", deviceType: "laptop" }
  ];
}

async function getDropUTXOs(dropIds) {
  // Get UTXOs for the drops to be processed
  return []; // Placeholder
}

// =============================================================================
// CONSTANTS - Deploy once, use forever
// =============================================================================

const CONTRACT_ADDRESS = "addr1_your_deployed_contract_address";
const DROP_VALIDATOR = "your_compiled_validator_script";
const BACKEND_WALLET_ID = process.env.FIREBLOCKS_BACKEND_WALLET;
const BACKEND_ADDRESS = "addr1_your_backend_signing_address";

// =============================================================================
// DEPLOYMENT - Just 4 serverless functions!
// =============================================================================

// Deploy these as:
// 1. /api/register-user (POST)
// 2. /api/submit-drop (POST) 
// 3. /api/user-balance/:userId (GET)
// 4. /api/batch-process (POST - Admin only)

export { registerUser, submitDrop, getUserBalance, batchProcess };({ error: error.message });
  }
}

// =============================================================================
// 2. SUBMIT DROP - User recycles item
// =============================================================================
export async function submitDrop(req, res) {
  try {
    const { userId, binId, photoHash, deviceType, location } = req.body;
    
    // Upload photo to IPFS and get hash
    const ipfsHash = await uploadToIPFS(req.body.photoFile);
    
    // Determine environmental risk
    const environmentalRisk = getEnvironmentalRisk(deviceType);
    
    // Generate unique drop ID
    const dropId = generateDropId();
    
    // Submit drop to smart contract
    const txHash = await submitDropOnChain({
      userId,
      binId,
      photoHash: ipfsHash,
      deviceType,
      environmentalRisk,
      location,
      dropId,
      autoDistribute: true  // Instant rewards!
    });
    
    // Calculate reward amount
    const rewardAda = calculateReward(environmentalRisk);
    
    res.json({
      success: true,
      dropId: dropId,
      transactionHash: txHash,
      estimatedReward: `${rewardAda} ADA`,
      message: "Drop submitted! Reward will be sent to your wallet."
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// =============================================================================
// 3. GET USER BALANCE - Check earnings
// =============================================================================
export async function getUserBalance(req, res) {
  try {
    const { userId } = req.params;
    
    // Get user's custodial wallet address
    const walletAddress = await getUserWallet(userId);
    
    // Check ADA balance via Fireblocks
    const balance = await fireblocks.getBalance(walletAddress, 'ADA');
    
    // Get user stats from blockchain
    const userStats = await getUserStatsFromChain(userId);
    
    res.json({
      totalEarned: `${userStats.totalEarned / 1000000} ADA`,
      totalDrops: userStats.totalDrops,
      currentBalance: `${balance.available} ADA`,
      pendingRewards: `${userStats.pendingRewards / 1000000} ADA`
    });
    
  } catch (error) {
    res.status(500).json