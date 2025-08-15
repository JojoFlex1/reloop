// RELOOP - E-waste Smart Contract with Consolidated Wallets
use aiken/builtin
use aiken/collection/list
use cardano/transaction.{Transaction, Input, InlineDatum, Output, OutputReference, ValidityRange}
// Removed unused import: from_verification_key
use cardano/assets.{lovelace_of}
use aiken/interval.{Finite}

// =============================================================================
// TYPES - WITH CONSOLIDATED WALLETS
// =============================================================================

// Wallet management for MVP
type WalletInfo {
  user_id: ByteArray,              // Unique user identifier from your app
  consolidated_wallet: ByteArray,   // Fireblocks consolidated wallet address
  individual_balance: Int,          // User's pending reward balance
  total_earned: Int,               // Total rewards earned by this user
  created_at: Int,                 // When wallet was created
}

// Updated drop data with consolidated wallet support
type DropDatum {
  drop_id: ByteArray,
  user_id: ByteArray,              // User ID instead of wallet directly
  user_wallet: ByteArray,          // Consolidated wallet for this user
  bin_qr_code: ByteArray,
  bin_location: Location,
  user_location: Location,
  device_type: ByteArray,
  photo_hash: ByteArray,
  reward_amount: Int,
  timestamp: Int,
  claimed: Bool,
  batch_id: Option<ByteArray>,     // For batch reward processing
}

// Batch reward processing for efficient payouts
type BatchDatum {
  batch_id: ByteArray,
  user_rewards: List<UserReward>,  // Multiple users in one transaction
  total_amount: Int,
  processed: Bool,
  created_at: Int,
}

type UserReward {
  user_id: ByteArray,
  consolidated_wallet: ByteArray,
  reward_amount: Int,
  drop_count: Int,                 // Number of drops in this batch
}

// Location coordinates (multiplied by 1000000 for precision)
type Location {
  latitude: Int,
  longitude: Int,
}

// Bin registry (unchanged)
type BinDatum {
  bin_id: ByteArray,
  qr_code: ByteArray,
  location: Location,
  bin_type: ByteArray,
  active: Bool,
  total_drops: Int,
}

// Enhanced actions for consolidated wallets
type RedeemAction {
  SubmitDrop                                    // User submits e-waste drop
  ClaimReward { user_id: ByteArray }           // User claims individual reward
  ProcessBatch { batch_id: ByteArray }         // Process batch rewards
  RegisterWallet { user_id: ByteArray }        // Register new user wallet
  RegisterBin                                  // Admin registers new bin
  DeactivateBin { bin_id: ByteArray }         // Admin deactivates bin
}

// =============================================================================
// MAIN VALIDATOR - HANDLES DROPS, BINS, WALLETS & BATCHES
// =============================================================================

validator reloop_treasury {
  spend(datum: Option<Data>, redeemer: Data, _ref: OutputReference, tx: Transaction) -> Bool {
    expect action: RedeemAction = redeemer
    
    // Handle different datum types
    when datum is {
      Some(datum_data) -> validate_any_datum_type(datum_data, action, tx)
      None -> False
    }
  }
}

// =============================================================================
// DATUM TYPE VALIDATION HELPERS
// =============================================================================

fn validate_any_datum_type(datum: Data, action: RedeemAction, tx: Transaction) -> Bool {
  // Based on action type, we know which datum type to expect
  when action is {
    SubmitDrop -> {
      expect drop: DropDatum = datum
      validate_drop_actions(drop, action, tx)
    }
    ClaimReward { user_id } -> {
      // FIXED: For claims, we should know the datum type from context
      // In practice, different UTXOs will have different datum types
      // For now, assume it's a drop and handle the error case
      expect drop: DropDatum = datum
      validate_individual_reward_claim(drop, user_id, tx)
    }
    RegisterBin -> {
      expect bin: BinDatum = datum
      validate_bin_actions(bin, action, tx)
    }
    DeactivateBin { .. } -> {
      expect bin: BinDatum = datum
      validate_bin_actions(bin, action, tx)
    }
    RegisterWallet { .. } -> {
      expect wallet: WalletInfo = datum
      validate_wallet_actions(wallet, action, tx)
    }
    ProcessBatch { .. } -> {
      expect batch: BatchDatum = datum
      validate_batch_actions(batch, action, tx)
    }
  }
}

// FIXED: This function was always returning "drop" which is a critical bug
// For ClaimReward action, we need to determine if we're dealing with a drop or wallet
// Since this is complex to determine safely, we should simplify the logic
// The caller should know what type of datum they're providing

// =============================================================================
// CONSOLIDATED WALLET VALIDATION
// =============================================================================

fn validate_wallet_actions(wallet: WalletInfo, action: RedeemAction, tx: Transaction) -> Bool {
  when action is {
    RegisterWallet { user_id } -> validate_wallet_registration(wallet, user_id, tx)
    ClaimReward { user_id } -> validate_wallet_claim(wallet, user_id, tx)
    _ -> False
  }
}

fn validate_wallet_registration(wallet: WalletInfo, target_user_id: ByteArray, tx: Transaction) -> Bool {
  let Transaction { outputs, validity_range, .. } = tx
  
  // Correct user
  wallet.user_id == target_user_id &&
  
  // New wallet validations
  wallet.user_id != #"" &&
  wallet.consolidated_wallet != #"" &&
  wallet.individual_balance == 0 &&
  wallet.total_earned == 0 &&
  
  // Timestamp validation
  timestamp_is_valid(wallet.created_at, validity_range) &&
  
  // Wallet stored in outputs
  wallet_stored_in_outputs(outputs, wallet)
}

fn validate_wallet_claim(wallet: WalletInfo, target_user_id: ByteArray, tx: Transaction) -> Bool {
  let Transaction { outputs, .. } = tx
  
  // Correct user
  wallet.user_id == target_user_id &&
  
  // Has balance to claim
  wallet.individual_balance > 0 &&
  
  // User receives their balance
  user_receives_reward(outputs, wallet.consolidated_wallet, wallet.individual_balance) &&
  
  // Wallet balance reset
  wallet_balance_reset(outputs, wallet)
}

// =============================================================================
// BATCH PROCESSING VALIDATION  
// =============================================================================

fn validate_batch_actions(batch: BatchDatum, action: RedeemAction, tx: Transaction) -> Bool {
  when action is {
    ProcessBatch { batch_id } -> validate_batch_processing(batch, batch_id, tx)
    _ -> False
  }
}

fn validate_batch_processing(batch: BatchDatum, target_batch_id: ByteArray, tx: Transaction) -> Bool {
  let Transaction { outputs, .. } = tx
  
  batch.batch_id == target_batch_id &&
  !batch.processed &&
  batch.total_amount > 0 &&
  list.length(batch.user_rewards) > 0 &&
  list.length(batch.user_rewards) <= 50 &&  // Max 50 users per batch (scalable)
  all_batch_rewards_paid(outputs, batch.user_rewards) &&
  batch_marked_processed(outputs, batch) &&
  batch_total_is_correct(batch)
}

// =============================================================================
// DROP VALIDATION - UPDATED FOR CONSOLIDATED WALLETS
// =============================================================================

fn validate_drop_actions(drop: DropDatum, action: RedeemAction, tx: Transaction) -> Bool {
  when action is {
    SubmitDrop -> validate_drop_submission(drop, tx)
    ClaimReward { user_id } -> validate_individual_reward_claim(drop, user_id, tx)
    _ -> False
  }
}

fn validate_drop_submission(drop: DropDatum, tx: Transaction) -> Bool {
  let Transaction { outputs, inputs, validity_range, .. } = tx
  
  // Basic drop validations
  drop.drop_id != #"" &&
  drop.user_id != #"" &&
  drop.user_wallet != #"" &&
  drop.bin_qr_code != #"" &&
  drop.device_type != #"" &&
  drop.photo_hash != #"" &&
  !drop.claimed &&
  
  // Photo hash must be valid (SHA-256)
  builtin.length_of_bytearray(drop.photo_hash) == 32 &&
  
  // Device type and reward validation
  is_valid_device_type(drop.device_type) &&
  reward_amount_is_correct(drop.device_type, drop.reward_amount) &&
  
  // Location validations
  location_is_valid(drop.bin_location) &&
  location_is_valid(drop.user_location) &&
  user_near_bin(drop.user_location, drop.bin_location) &&
  
  // Bin validation
  bin_exists_and_active(inputs, drop.bin_qr_code, drop.bin_location) &&
  
  // User wallet exists and is valid
  user_wallet_is_registered(inputs, drop.user_id, drop.user_wallet) &&
  
  // Timestamp validation
  timestamp_is_valid(drop.timestamp, validity_range) &&
  
  // Drop stored correctly
  drop_stored_in_outputs(outputs, drop) &&
  
  // Update bin drop count
  bin_drop_count_updated(outputs, inputs, drop.bin_qr_code) &&
  
  // Update user wallet balance (add to pending rewards)
  user_wallet_balance_updated(outputs, inputs, drop.user_id, drop.reward_amount)
}

fn validate_individual_reward_claim(drop: DropDatum, claim_user_id: ByteArray, tx: Transaction) -> Bool {
  let Transaction { outputs, .. } = tx
  
  // Correct user
  drop.user_id == claim_user_id &&
  
  // Not already claimed
  !drop.claimed &&
  
  // User receives reward to their consolidated wallet
  user_receives_reward(outputs, drop.user_wallet, drop.reward_amount) &&
  
  // Drop marked as claimed
  drop_marked_as_claimed(outputs, drop)
}

// =============================================================================
// HELPER FUNCTIONS FOR CONSOLIDATED WALLETS
// =============================================================================

fn user_wallet_is_registered(inputs: List<Input>, user_id: ByteArray, wallet_address: ByteArray) -> Bool {
  list.any(inputs, fn(input) {
    when input.output.datum is {
      InlineDatum(data) -> {
        expect wallet: WalletInfo = data
        wallet.user_id == user_id &&
        wallet.consolidated_wallet == wallet_address
      }
      _ -> False
    }
  })
}

fn user_wallet_balance_updated(outputs: List<Output>, inputs: List<Input>, user_id: ByteArray, reward_amount: Int) -> Bool {
  when find_wallet_in_inputs(inputs, user_id) is {
    Some(original_wallet) -> {
      // FIXED: Add basic overflow protection
      let new_balance = original_wallet.individual_balance + reward_amount
      let new_total = original_wallet.total_earned + reward_amount
      
      // Basic sanity checks
      if new_balance < 0 || new_total < 0 || reward_amount <= 0 {
        False
      } else {
        let updated_wallet = WalletInfo { 
          ..original_wallet, 
          individual_balance: new_balance,
          total_earned: new_total,
        }
        
        wallet_stored_in_outputs(outputs, updated_wallet)
      }
    }
    None -> False  // Wallet must exist
  }
}

fn wallet_balance_reset(outputs: List<Output>, original_wallet: WalletInfo) -> Bool {
  let reset_wallet = WalletInfo { 
    ..original_wallet, 
    individual_balance: 0 
  }
  
  wallet_stored_in_outputs(outputs, reset_wallet)
}

fn find_wallet_in_inputs(inputs: List<Input>, user_id: ByteArray) -> Option<WalletInfo> {
  when inputs is {
    [] -> None
    [input, ..rest] -> {
      when input.output.datum is {
        InlineDatum(data) -> {
          expect wallet: WalletInfo = data
          if wallet.user_id == user_id {
            Some(wallet)
          } else {
            find_wallet_in_inputs(rest, user_id)
          }
        }
        _ -> find_wallet_in_inputs(rest, user_id)
      }
    }
  }
}

fn all_batch_rewards_paid(outputs: List<Output>, user_rewards: List<UserReward>) -> Bool {
  list.all(user_rewards, fn(user_reward) {
    user_receives_reward(outputs, user_reward.consolidated_wallet, user_reward.reward_amount)
  })
}

fn batch_marked_processed(outputs: List<Output>, original_batch: BatchDatum) -> Bool {
  let processed_batch = BatchDatum { ..original_batch, processed: True }
  
  list.any(outputs, fn(output) {
    when output.datum is {
      InlineDatum(data) -> {
        expect batch: BatchDatum = data
        batch == processed_batch
      }
      _ -> False
    }
  })
}

fn batch_total_is_correct(batch: BatchDatum) -> Bool {
  let calculated_total = list.foldr(batch.user_rewards, 0, fn(user_reward, acc) {
    acc + user_reward.reward_amount
  })
  
  batch.total_amount == calculated_total
}

fn wallet_stored_in_outputs(outputs: List<Output>, wallet: WalletInfo) -> Bool {
  list.any(outputs, fn(output) {
    when output.datum is {
      InlineDatum(data) -> {
        expect stored_wallet: WalletInfo = data
        stored_wallet == wallet
      }
      _ -> False
    }
  })
}

// =============================================================================
// EXISTING FUNCTIONS (unchanged from original)
// =============================================================================

fn validate_bin_actions(bin: BinDatum, action: RedeemAction, tx: Transaction) -> Bool {
  when action is {
    RegisterBin -> validate_bin_registration(bin, tx)
    DeactivateBin { bin_id } -> validate_bin_deactivation(bin, bin_id, tx)
    _ -> False
  }
}

fn validate_bin_registration(bin: BinDatum, tx: Transaction) -> Bool {
  let Transaction { outputs, .. } = tx
  
  bin.bin_id != #"" &&
  bin.qr_code != #"" &&
  bin.active &&
  bin.total_drops == 0 &&
  location_is_valid(bin.location) &&
  is_valid_bin_type(bin.bin_type) &&
  bin_stored_in_outputs(outputs, bin)
}

fn validate_bin_deactivation(bin: BinDatum, target_bin_id: ByteArray, tx: Transaction) -> Bool {
  let Transaction { outputs, .. } = tx
  
  bin.bin_id == target_bin_id &&
  bin_marked_inactive(outputs, bin)
}

fn is_valid_device_type(device_type: ByteArray) -> Bool {
  device_type == "usb_cable" ||
  device_type == "phone_charger" ||
  device_type == "laptop_charger" ||
  device_type == "hdmi_cable" ||
  device_type == "audio_cable" ||
  device_type == "headphones" ||
  device_type == "earbuds" ||
  device_type == "bluetooth_speaker" ||
  device_type == "computer_mouse" ||
  device_type == "keyboard" ||
  device_type == "remote_control" ||
  device_type == "calculator" ||
  device_type == "smartphone" ||
  device_type == "basic_phone" ||
  device_type == "smartwatch" ||
  device_type == "fitness_tracker" ||
  device_type == "portable_speaker" ||
  device_type == "gaming_controller" ||
  device_type == "tablet" ||
  device_type == "laptop" ||
  device_type == "desktop_computer" ||
  device_type == "monitor" ||
  device_type == "printer" ||
  device_type == "phone_battery" ||
  device_type == "laptop_battery" ||
  device_type == "power_bank" ||
  device_type == "car_battery" ||
  device_type == "ups_battery"
}

fn reward_amount_is_correct(device_type: ByteArray, reward_amount: Int) -> Bool {
  let expected_reward = get_device_reward(device_type)
  reward_amount == expected_reward
}

fn get_device_reward(device_type: ByteArray) -> Int {
  if device_type == "usb_cable" ||
     device_type == "phone_charger" ||
     device_type == "laptop_charger" ||
     device_type == "hdmi_cable" ||
     device_type == "audio_cable" {
    1_000_000  // 1 ADA
  }
  else if device_type == "headphones" ||
          device_type == "earbuds" ||
          device_type == "bluetooth_speaker" ||
          device_type == "computer_mouse" ||
          device_type == "keyboard" ||
          device_type == "remote_control" ||
          device_type == "calculator" {
    1_500_000  // 1.5 ADA
  }
  else if device_type == "smartphone" ||
          device_type == "basic_phone" ||
          device_type == "smartwatch" ||
          device_type == "fitness_tracker" ||
          device_type == "portable_speaker" ||
          device_type == "gaming_controller" {
    3_000_000  // 3 ADA
  }
  else if device_type == "tablet" ||
          device_type == "laptop" ||
          device_type == "desktop_computer" ||
          device_type == "monitor" ||
          device_type == "printer" {
    5_000_000  // 5 ADA
  }
  else if device_type == "phone_battery" ||
          device_type == "laptop_battery" ||
          device_type == "power_bank" ||
          device_type == "car_battery" ||
          device_type == "ups_battery" {
    7_000_000  // 7 ADA
  }
  else {
    3_000_000
  }
}

fn location_is_valid(location: Location) -> Bool {
  location.latitude >= -90_000_000 &&
  location.latitude <= 90_000_000 &&
  location.longitude >= -180_000_000 &&
  location.longitude <= 180_000_000
}

fn user_near_bin(user_loc: Location, bin_loc: Location) -> Bool {
  let lat_diff = if user_loc.latitude > bin_loc.latitude {
    user_loc.latitude - bin_loc.latitude
  } else {
    bin_loc.latitude - user_loc.latitude
  }
  
  let lng_diff = if user_loc.longitude > bin_loc.longitude {
    user_loc.longitude - bin_loc.longitude  
  } else {
    bin_loc.longitude - user_loc.longitude
  }
  
  lat_diff <= 1_000 &&
  lng_diff <= 1_000
}

fn bin_exists_and_active(inputs: List<Input>, qr_code: ByteArray, location: Location) -> Bool {
  list.any(inputs, fn(input) {
    when input.output.datum is {
      InlineDatum(data) -> {
        expect bin: BinDatum = data
        bin.qr_code == qr_code &&
        bin.location == location &&
        bin.active
      }
      _ -> False
    }
  })
}

fn is_valid_bin_type(bin_type: ByteArray) -> Bool {
  bin_type == "standard" ||
  bin_type == "battery" ||
  bin_type == "hazardous"
}

fn timestamp_is_valid(timestamp: Int, validity_range: ValidityRange) -> Bool {
  when validity_range.lower_bound.bound_type is {
    Finite(current_time) -> 
      timestamp > 0 &&
      timestamp >= current_time - 300 &&
      timestamp <= current_time + 60
    _ -> timestamp > 0
  }
}

fn drop_stored_in_outputs(outputs: List<Output>, drop: DropDatum) -> Bool {
  list.any(outputs, fn(output) {
    when output.datum is {
      InlineDatum(data) -> {
        expect stored_drop: DropDatum = data
        stored_drop == drop
      }
      _ -> False
    }
  })
}

fn bin_stored_in_outputs(outputs: List<Output>, bin: BinDatum) -> Bool {
  list.any(outputs, fn(output) {
    when output.datum is {
      InlineDatum(data) -> {
        expect stored_bin: BinDatum = data
        stored_bin == bin
      }
      _ -> False
    }
  })
}

fn user_receives_reward(outputs: List<Output>, user_wallet: ByteArray, reward_amount: Int) -> Bool {
  // FIXED: user_wallet should be treated as an address, not a verification key
  // The consolidated wallet address should be directly usable
  list.any(outputs, fn(output) {
    // Compare address bytes directly since user_wallet is already an address
    builtin.serialise_data(output.address) == user_wallet &&
    lovelace_of(output.value) >= reward_amount
  })
}

fn drop_marked_as_claimed(outputs: List<Output>, original_drop: DropDatum) -> Bool {
  let claimed_drop = DropDatum { ..original_drop, claimed: True }
  
  list.any(outputs, fn(output) {
    when output.datum is {
      InlineDatum(data) -> {
        expect drop: DropDatum = data
        drop == claimed_drop
      }
      _ -> False
    }
  })
}

fn bin_drop_count_updated(outputs: List<Output>, inputs: List<Input>, bin_qr: ByteArray) -> Bool {
  when find_bin_in_inputs(inputs, bin_qr) is {
    Some(original_bin) -> {
      let updated_bin = BinDatum { 
        ..original_bin, 
        total_drops: original_bin.total_drops + 1 
      }
      
      list.any(outputs, fn(output) {
        when output.datum is {
          InlineDatum(data) -> {
            expect bin: BinDatum = data
            bin == updated_bin
          }
          _ -> False
        }
      })
    }
    None -> False  // FIXED: If bin not found in inputs, validation should fail
  }
}

fn bin_marked_inactive(outputs: List<Output>, original_bin: BinDatum) -> Bool {
  let inactive_bin = BinDatum { ..original_bin, active: False }
  
  list.any(outputs, fn(output) {
    when output.datum is {
      InlineDatum(data) -> {
        expect bin: BinDatum = data
        bin == inactive_bin
      }
      _ -> False
    }
  })
}

fn find_bin_in_inputs(inputs: List<Input>, qr_code: ByteArray) -> Option<BinDatum> {
  when inputs is {
    [] -> None
    [input, ..rest] -> {
      when input.output.datum is {
        InlineDatum(data) -> {
          expect bin: BinDatum = data
          if bin.qr_code == qr_code {
            Some(bin)
          } else {
            find_bin_in_inputs(rest, qr_code)
          }
        }
        _ -> find_bin_in_inputs(rest, qr_code)
      }
    }
  }
}





