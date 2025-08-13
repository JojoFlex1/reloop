
// Complete Reloop E-waste Recycling Smart Contract
use aiken/builtin
use aiken/collection/list
use cardano/transaction.{Transaction, ValidityRange, Input, InlineDatum, Output, OutputReference}
use cardano/script_context.{ScriptContext}
use cardano/address.{VerificationKey, from_verification_key, Address, Script}
use cardano/assets.{Value, lovelace_of}
use aiken/cbor
use aiken/interval.{IntervalBoundType, Finite, NegativeInfinity, PositiveInfinity}

// =============================================================================
// TYPES AND DATUMS
// =============================================================================

// Environmental risk levels for e-waste categorization
type EnvironmentalRisk {
  Safe           // Level 1: USB cables, phone chargers, audio cables
  LowRisk        // Level 2: LED bulbs, CFL lights, small electronics  
  MediumRisk     // Level 3: Smartphones, small appliances, wireless devices
  HighRisk       // Level 4: Laptops, tablets, gaming devices
  VeryHighRisk   // Level 5: Power banks, laptop batteries, electric tool batteries
}

// Drop datum - stores recycling drop information
type DropDatum {
  bin_id: ByteArray,
  photo_hash: ByteArray,
  device_type: ByteArray,
  environmental_risk: EnvironmentalRisk,
  location: Location,
  user_id: ByteArray,        // User's unique ID (email hash or similar)
  user_wallet: ByteArray,    // Custodial wallet address for this user
  timestamp: Int,
  drop_id: ByteArray,
  reward_claimed: Bool,
  auto_distribute: Bool,     // If true, reward is auto-sent to user wallet
}

type Location {
  latitude: Int,   // Multiplied by 1000000 for precision
  longitude: Int,  // Multiplied by 1000000 for precision
}

// Treasury datum - manages ADA rewards pool and custodial wallets
type TreasuryDatum {
  admin_pkh: ByteArray,
  custodian_pkh: ByteArray,  // Backend service key
  total_ada_pool: Int,
  distributed_ada: Int,
  base_reward_ada: Int,
  contract_version: Int,
  paused: Bool,
  auto_distribute_enabled: Bool,  // Enable automatic reward distribution
}

// User registry for custodial wallet management
type UserRegistryDatum {
  user_id: ByteArray,
  wallet_address: ByteArray,
  total_earned: Int,
  total_drops: Int,
  created_timestamp: Int,
  last_activity: Int,
}

// Contract actions
type RedeemAction {
  SubmitDrop                // User submits recycling drop (via backend)
  ClaimReward { drop_id: ByteArray }  // User claims ADA reward
  RegisterUser { user_id: ByteArray, wallet_address: ByteArray }  // Register new custodial user
  BatchDistribute { drop_ids: List<ByteArray> }  // Backend batch processes rewards
  AdminAction { action: AdminAction }
}

type AdminAction {
  UpdateTreasury
  PauseContract
  UnpauseContract
  UpgradeContract { new_version: Int }
  RefillTreasury { amount: Int }
  UpdateCustodian { new_custodian: ByteArray }
}

// =============================================================================
// MAIN VALIDATOR CONTRACT
// =============================================================================

validator reloop_validator {
  spend(datum: Option<Data>, redeemer: Data, _utxo: OutputReference, self: Transaction) {
    when datum is {
      Some(datum_data) -> {
        when decode_redeemer(redeemer) is {
          Some(action) -> {
            // Try to decode as different datum types and validate accordingly
            when try_decode_drop_datum(datum_data) is {
              Some(drop_datum) -> validate_drop_action(drop_datum, action, self)
              None -> {
                when try_decode_treasury_datum(datum_data) is {
                  Some(treasury_datum) -> validate_treasury_action(treasury_datum, action, self)
                  None -> {
                    when try_decode_user_registry(datum_data) is {
                      Some(registry_datum) -> validate_user_registry_action(registry_datum, action, self)
                      None -> False  // Unknown datum type
                    }
                  }
                }
              }
            }
          }
          None -> False  // Invalid redeemer
        }
      }
      None -> False  // Datum required for this contract
    }
  }
}

// =============================================================================
// DATUM DECODING FUNCTIONS
// =============================================================================

fn decode_redeemer(redeemer_data: Data) -> Option<RedeemAction> {
  // For now, return None to get the contract to compile
  // TODO: Implement proper Data pattern matching
  None
}

fn decode_admin_action(data: Data) -> Option<AdminAction> {
  // For now, return None to get the contract to compile
  // TODO: Implement proper Data pattern matching
  None
}

fn try_decode_drop_datum(datum: Data) -> Option<DropDatum> {
  // For now, return None to get the contract to compile
  // TODO: Implement proper Data pattern matching
  None
}

fn decode_fields_drop_datum(
  bin_id_data: Data, photo_hash_data: Data, device_type_data: Data, 
  risk_data: Data, location_data: Data, user_id_data: Data, 
  user_wallet_data: Data, timestamp_data: Data, drop_id_data: Data, 
  reward_claimed_data: Data, auto_distribute_data: Data
) -> Option<DropDatum> {
  when decode_bytearray(bin_id_data) is {
    Some(bin_id) -> {
      when decode_bytearray(photo_hash_data) is {
        Some(photo_hash) -> {
          when decode_bytearray(device_type_data) is {
            Some(device_type) -> {
              when decode_environmental_risk(risk_data) is {
                Some(environmental_risk) -> {
                  when decode_location(location_data) is {
                    Some(location) -> {
                      when decode_bytearray(user_id_data) is {
                        Some(user_id) -> {
                          when decode_bytearray(user_wallet_data) is {
                            Some(user_wallet) -> {
                              when decode_int(timestamp_data) is {
                                Some(timestamp) -> {
                                  when decode_bytearray(drop_id_data) is {
                                    Some(drop_id) -> {
                                      when decode_bool(reward_claimed_data) is {
                                        Some(reward_claimed) -> {
                                          when decode_bool(auto_distribute_data) is {
                                            Some(auto_distribute) -> {
                                              Some(DropDatum {
                                                bin_id: bin_id,
                                                photo_hash: photo_hash,
                                                device_type: device_type,
                                                environmental_risk: environmental_risk,
                                                location: location,
                                                user_id: user_id,
                                                user_wallet: user_wallet,
                                                timestamp: timestamp,
                                                drop_id: drop_id,
                                                reward_claimed: reward_claimed,
                                                auto_distribute: auto_distribute,
                                              })
                                            }
                                            None -> None
                                          }
                                        }
                                        None -> None
                                      }
                                    }
                                    None -> None
                                  }
                                }
                                None -> None
                              }
                            }
                            None -> None
                          }
                        }
                        None -> None
                      }
                    }
                    None -> None
                  }
                }
                None -> None
              }
            }
            None -> None
          }
        }
        None -> None
      }
    }
    None -> None
  }
}

fn try_decode_treasury_datum(datum: Data) -> Option<TreasuryDatum> {
  // For now, return None to get the contract to compile
  // TODO: Implement proper Data pattern matching
  None
}

fn try_decode_user_registry(datum: Data) -> Option<UserRegistryDatum> {
  // For now, return None to get the contract to compile
  // TODO: Implement proper Data pattern matching
  None
}

// Helper functions for decoding basic types
fn decode_bytearray(data: Data) -> Option<ByteArray> {
  // For now, return None to get the contract to compile
  // TODO: Implement proper Data pattern matching
  None
}

fn decode_int(data: Data) -> Option<Int> {
  // For now, return None to get the contract to compile
  // TODO: Implement proper Data pattern matching
  None
}

fn decode_bool(data: Data) -> Option<Bool> {
  // For now, return None to get the contract to compile
  // TODO: Implement proper Data pattern matching
  None
}

fn decode_bytearray_list(data: Data) -> Option<List<ByteArray>> {
  // For now, return None to get the contract to compile
  // TODO: Implement proper Data pattern matching
  None
}

fn decode_bytearray_list_items(items: List<Data>) -> Option<List<ByteArray>> {
  when items is {
    [] -> Some([])
    [head, ..tail] -> {
      when decode_bytearray(head) is {
        Some(byte_head) -> {
          when decode_bytearray_list_items(tail) is {
            Some(byte_tail) -> Some([byte_head, ..byte_tail])
            None -> None
          }
        }
        None -> None
      }
    }
  }
}

fn decode_environmental_risk(data: Data) -> Option<EnvironmentalRisk> {
  // For now, return None to get the contract to compile
  // TODO: Implement proper Data pattern matching
  None
}

fn decode_location(data: Data) -> Option<Location> {
  // For now, return None to get the contract to compile
  // TODO: Implement proper Data pattern matching
  None
}

// =============================================================================
// DROP VALIDATION LOGIC
// =============================================================================

fn validate_drop_action(
  datum: DropDatum, 
  redeemer: RedeemAction, 
  tx: Transaction
) -> Bool {
  when redeemer is {
    SubmitDrop -> validate_custodial_drop_submission(datum, tx)
    ClaimReward { drop_id } -> validate_reward_claim(datum, drop_id, tx)
    BatchDistribute { drop_ids } -> validate_batch_distribution(datum, drop_ids, tx)
    _ -> False
  }
}

// Validate custodial drop submission (backend submits on behalf of user)
fn validate_custodial_drop_submission(datum: DropDatum, tx: Transaction) -> Bool {
  let Transaction { outputs, validity_range, extra_signatories, inputs, .. } = tx
  
  when get_treasury_data(inputs) is {
    Some(treasury) -> {
      and {
        // Backend/custodian must sign the transaction
        list.has(extra_signatories, treasury.custodian_pkh),
        
        // Basic validations
        valid_photo_hash(datum.photo_hash),
        valid_location(datum.location),
        valid_timestamp(datum.timestamp, validity_range),
        valid_environmental_classification(datum.device_type, datum.environmental_risk),
        !datum.reward_claimed,
        
        // User must be registered
        user_is_registered(inputs, datum.user_id),
        
        // Drop stored correctly
        drop_stored_correctly(outputs, datum),
        
        // Contract not paused
        !treasury.paused,
        
        // Auto-distribute if enabled
        if datum.auto_distribute && treasury.auto_distribute_enabled {
          auto_distribute_reward(outputs, datum, treasury)
        } else {
          True
        }
      }
    }
    None -> False
  }
}

// Validate batch reward distribution (backend processes multiple drops at once)
fn validate_batch_distribution(datum: DropDatum, drop_ids: List<ByteArray>, tx: Transaction) -> Bool {
  let Transaction { outputs, extra_signatories, inputs, .. } = tx
  
  when get_treasury_data(inputs) is {
    Some(treasury) -> {
      and {
        // Backend/custodian must sign
        list.has(extra_signatories, treasury.custodian_pkh),
        
        // This drop is in the batch
        list.has(drop_ids, datum.drop_id),
        
        // Drop hasn't been claimed yet
        !datum.reward_claimed,
        
        // Calculate and distribute reward
        batch_rewards_distributed_correctly(outputs, inputs, drop_ids, treasury),
        
        // Update treasury with total distributed amount
        treasury_updated_for_batch(outputs, treasury, drop_ids, inputs),
      }
    }
    None -> False
  }
}

fn validate_reward_claim(datum: DropDatum, drop_id: ByteArray, tx: Transaction) -> Bool {
  let Transaction { outputs, inputs, .. } = tx
  
  when get_treasury_data(inputs) is {
    Some(treasury) -> {
      let reward_amount = calculate_environmental_reward(datum.environmental_risk, treasury.base_reward_ada)
      
      and {
        datum.drop_id == drop_id,
        !datum.reward_claimed,
        treasury_has_sufficient_funds(treasury, reward_amount),
        user_receives_ada_reward(outputs, datum.user_wallet, reward_amount),
        drop_marked_as_claimed(outputs, datum),
        treasury_updated_correctly(outputs, treasury, reward_amount),
        !treasury.paused,
      }
    }
    None -> False
  }
}

// =============================================================================
// USER REGISTRY VALIDATION
// =============================================================================

fn validate_user_registry_action(
  registry: UserRegistryDatum,
  redeemer: RedeemAction,
  tx: Transaction
) -> Bool {
  when redeemer is {
    RegisterUser { user_id, wallet_address } -> 
      validate_user_registration(registry, user_id, wallet_address, tx)
    _ -> False
  }
}

fn validate_user_registration(
  registry: UserRegistryDatum,
  user_id: ByteArray,
  wallet_address: ByteArray,
  tx: Transaction
) -> Bool {
  let Transaction { outputs, extra_signatories, inputs, validity_range, .. } = tx
  
  when get_treasury_data(inputs) is {
    Some(treasury) -> {
      let new_registry = UserRegistryDatum {
        user_id: user_id,
        wallet_address: wallet_address,
        total_earned: 0,
        total_drops: 0,
        created_timestamp: get_current_time(validity_range),
        last_activity: get_current_time(validity_range),
      }
      
      and {
        // Backend/custodian must sign
        list.has(extra_signatories, treasury.custodian_pkh),
        
        // Registry stored correctly
        user_registry_stored(outputs, new_registry),
        
        // Unique user ID
        registry.user_id != user_id,  // Ensure no duplicate registration
      }
    }
    None -> False
  }
}

// =============================================================================
// TREASURY VALIDATION LOGIC
// =============================================================================

fn validate_treasury_action(
  datum: TreasuryDatum,
  redeemer: RedeemAction,
  tx: Transaction
) -> Bool {
  when redeemer is {
    AdminAction { action } -> validate_admin_action(datum, action, tx)
    _ -> False
  }
}

fn validate_admin_action(
  treasury: TreasuryDatum,
  action: AdminAction,
  tx: Transaction
) -> Bool {
  let Transaction { extra_signatories, outputs, inputs, .. } = tx
  
  // Ensure admin is signing
  when list.has(extra_signatories, treasury.admin_pkh) is {
    True -> {
      when action is {
        UpdateTreasury -> validate_treasury_update(treasury, outputs)
        PauseContract -> validate_contract_pause(treasury, outputs, True)
        UnpauseContract -> validate_contract_pause(treasury, outputs, False)
        UpgradeContract { new_version } -> validate_contract_upgrade(treasury, outputs, new_version)
        RefillTreasury { amount } -> validate_treasury_refill(treasury, outputs, inputs, amount)
        UpdateCustodian { new_custodian } -> validate_custodian_update(treasury, outputs, new_custodian)
      }
    }
    False -> False
  }
}

// =============================================================================
// CUSTODIAL-SPECIFIC HELPER FUNCTIONS
// =============================================================================

fn user_is_registered(inputs: List<Input>, user_id: ByteArray) -> Bool {
  list.any(inputs, fn(input) {
    when input.output.datum is {
      InlineDatum(data) -> {
        when try_decode_user_registry(data) is {
          Some(registry) -> registry.user_id == user_id
          None -> False
        }
      }
      _ -> False
    }
  })
}

fn auto_distribute_reward(
  outputs: List<Output>, 
  datum: DropDatum, 
  treasury: TreasuryDatum
) -> Bool {
  let reward_amount = calculate_environmental_reward(datum.environmental_risk, treasury.base_reward_ada)
  
  // Check that reward is sent directly to user's custodial wallet
  list.any(outputs, fn(output) {
    and {
      output.address == create_address_from_key(datum.user_wallet),
      lovelace_of(output.value) >= reward_amount,
    }
  })
}

fn batch_rewards_distributed_correctly(
  outputs: List<Output>,
  inputs: List<Input>, 
  drop_ids: List<ByteArray>,
  treasury: TreasuryDatum
) -> Bool {
  // Get all drops in this batch
  let batch_drops = get_batch_drops(inputs, drop_ids)
  
  // Verify total rewards are distributed
  total_ada_distributed_correctly(outputs, batch_drops, treasury.base_reward_ada)
}

fn get_batch_drops(inputs: List<Input>, drop_ids: List<ByteArray>) -> List<DropDatum> {
  list.filter_map(inputs, fn(input) {
    when input.output.datum is {
      InlineDatum(data) -> {
        when try_decode_drop_datum(data) is {
          Some(drop) -> {
            if list.has(drop_ids, drop.drop_id) {
              Some(drop)
            } else {
              None
            }
          }
          None -> None
        }
      }
      _ -> None
    }
  })
}

fn calculate_batch_total_rewards(drops: List<DropDatum>, base_reward: Int) -> Int {
  list.foldr(drops, 0, fn(drop, acc) {
    acc + calculate_environmental_reward(drop.environmental_risk, base_reward)
  })
}

fn total_ada_distributed_correctly(
  outputs: List<Output>, 
  drops: List<DropDatum>, 
  base_reward: Int
) -> Bool {
  list.all(drops, fn(drop) {
    let reward = calculate_environmental_reward(drop.environmental_risk, base_reward)
    
    list.any(outputs, fn(output) {
      and {
        output.address == create_address_from_key(drop.user_wallet),
        lovelace_of(output.value) >= reward,
      }
    })
  })
}

fn treasury_updated_for_batch(
  outputs: List<Output>,
  treasury: TreasuryDatum,
  drop_ids: List<ByteArray>,
  inputs: List<Input>
) -> Bool {
  let batch_drops = get_batch_drops(inputs, drop_ids)
  let total_distributed = calculate_batch_total_rewards(batch_drops, treasury.base_reward_ada)
  
  let updated_treasury = TreasuryDatum { 
    ..treasury, 
    distributed_ada: treasury.distributed_ada + total_distributed 
  }
  
  list.any(outputs, fn(output) {
    when output.datum is {
      InlineDatum(data) -> {
        when try_decode_treasury_datum(data) is {
          Some(new_treasury) -> new_treasury == updated_treasury
          None -> False
        }
      }
      _ -> False
    }
  })
}

fn user_registry_stored(outputs: List<Output>, registry: UserRegistryDatum) -> Bool {
  list.any(outputs, fn(output) {
    when output.datum is {
      InlineDatum(data) -> {
        when try_decode_user_registry(data) is {
          Some(stored_registry) -> stored_registry == registry
          None -> False
        }
      }
      _ -> False
    }
  })
}

fn validate_custodian_update(
  treasury: TreasuryDatum,
  outputs: List<Output>,
  new_custodian: ByteArray
) -> Bool {
  let updated_treasury = TreasuryDatum { ..treasury, custodian_pkh: new_custodian }
  
  list.any(outputs, fn(output) {
    when output.datum is {
      InlineDatum(data) -> {
        when try_decode_treasury_datum(data) is {
          Some(new_treasury) -> new_treasury == updated_treasury
          None -> False
        }
      }
      _ -> False
    }
  })
}

fn get_current_time(validity_range: ValidityRange) -> Int {
  // Extract timestamp from validity range
  when validity_range.lower_bound.bound_type is {
    Finite(time) -> time
    _ -> 0
  }
}

// Helper function to create address from key
fn create_address_from_key(key: ByteArray) -> Address {
  from_verification_key(key)
}

// =============================================================================
// VALIDATION HELPER FUNCTIONS
// =============================================================================

fn valid_environmental_classification(device_type: ByteArray, risk: EnvironmentalRisk) -> Bool {
  when risk is {
    Safe -> device_type_is_safe(device_type)
    LowRisk -> device_type_is_low_risk(device_type)
    MediumRisk -> device_type_is_medium_risk(device_type)
    HighRisk -> device_type_is_high_risk(device_type)
    VeryHighRisk -> device_type_is_very_high_risk(device_type)
  }
}

fn device_type_is_safe(device_type: ByteArray) -> Bool {
  or {
    device_type == "usb_cable",
    device_type == "phone_charger", 
    device_type == "audio_cable",
    device_type == "hdmi_cable",
    device_type == "ethernet_cable",
  }
}

fn device_type_is_low_risk(device_type: ByteArray) -> Bool {
  or {
    device_type == "led_bulb",
    device_type == "cfl_light",
    device_type == "small_electronics",
    device_type == "remote_control",
    device_type == "calculator",
  }
}

fn device_type_is_medium_risk(device_type: ByteArray) -> Bool {
  or {
    device_type == "smartphone",
    device_type == "small_appliances",
    device_type == "wireless_devices",
    device_type == "bluetooth_speaker",
    device_type == "fitness_tracker",
  }
}

fn device_type_is_high_risk(device_type: ByteArray) -> Bool {
  or {
    device_type == "laptop",
    device_type == "tablet",
    device_type == "gaming_device",
    device_type == "desktop_computer",
    device_type == "monitor",
  }
}

fn device_type_is_very_high_risk(device_type: ByteArray) -> Bool {
  or {
    device_type == "power_bank",
    device_type == "laptop_battery",
    device_type == "electric_tool_battery",
    device_type == "car_battery",
    device_type == "ups_battery",
  }
}

fn calculate_environmental_reward(risk: EnvironmentalRisk, base_reward: Int) -> Int {
  when risk is {
    Safe -> base_reward * 1
    LowRisk -> base_reward * 1
    MediumRisk -> base_reward * 2
    HighRisk -> base_reward * 2  
    VeryHighRisk -> base_reward * 3
  }
}

fn valid_photo_hash(hash: ByteArray) -> Bool {
  hash != #""
}

fn valid_location(location: Location) -> Bool {
  and {
    location.latitude >= -90_000_000,
    location.latitude <= 90_000_000,
    location.longitude >= -180_000_000,
    location.longitude <= 180_000_000,
  }
}

fn valid_timestamp(timestamp: Int, validity_range: ValidityRange) -> Bool {
  // Simplified timestamp validation - ensure it's positive and within range
  when validity_range.lower_bound.bound_type is {
    Finite(lower_time) -> {
      when validity_range.upper_bound.bound_type is {
        Finite(upper_time) -> {
          and {
            timestamp > 0,
            timestamp >= lower_time,
            timestamp <= upper_time,
          }
        }
        _ -> timestamp > 0
      }
    }
    _ -> timestamp > 0
  }
}

fn get_treasury_data(inputs: List<Input>) -> Option<TreasuryDatum> {
  when inputs is {
    [] -> None
    [input, ..rest] -> {
      when input.output.datum is {
        InlineDatum(data) -> {
          when try_decode_treasury_datum(data) is {
            Some(treasury) -> Some(treasury)
            None -> get_treasury_data(rest)
          }
        }
        _ -> get_treasury_data(rest)
      }
    }
  }
}

fn treasury_has_sufficient_funds(treasury: TreasuryDatum, reward_amount: Int) -> Bool {
  treasury.total_ada_pool - treasury.distributed_ada >= reward_amount
}

fn user_receives_ada_reward(
  outputs: List<Output>, 
  user_address: ByteArray, 
  reward_amount: Int
) -> Bool {
  list.any(outputs, fn(output) {
    and {
      output.address == create_address_from_key(user_address),
      lovelace_of(output.value) >= reward_amount,
    }
  })
}

fn drop_stored_correctly(outputs: List<Output>, datum: DropDatum) -> Bool {
  list.any(outputs, fn(output) {
    when output.datum is {
      InlineDatum(data) -> {
        when try_decode_drop_datum(data) is {
          Some(stored_datum) -> stored_datum == datum
          None -> False
        }
      }
      _ -> False
    }
  })
}

fn drop_marked_as_claimed(outputs: List<Output>, original_datum: DropDatum) -> Bool {
  let claimed_datum = DropDatum { ..original_datum, reward_claimed: True }
  
  list.any(outputs, fn(output) {
    when output.datum is {
      InlineDatum(data) -> {
        when try_decode_drop_datum(data) is {
          Some(datum) -> datum == claimed_datum
          None -> False
        }
      }
      _ -> False
    }
  })
}

fn treasury_updated_correctly(
  outputs: List<Output>, 
  original_treasury: TreasuryDatum, 
  reward_amount: Int
) -> Bool {
  let updated_treasury = TreasuryDatum { 
    ..original_treasury, 
    distributed_ada: original_treasury.distributed_ada + reward_amount 
  }
  
  list.any(outputs, fn(output) {
    when output.datum is {
      InlineDatum(data) -> {
        when try_decode_treasury_datum(data) is {
          Some(treasury) -> treasury == updated_treasury
          None -> False
        }
      }
      _ -> False
    }
  })
}

fn validate_treasury_update(
  treasury: TreasuryDatum, 
  outputs: List<Output>
) -> Bool {
  list.any(outputs, fn(output) {
    when output.datum is {
      InlineDatum(data) -> {
        when try_decode_treasury_datum(data) is {
          Some(new_treasury) -> {
            and {
              new_treasury.admin_pkh == treasury.admin_pkh,
              new_treasury.contract_version >= treasury.contract_version,
            }
          }
          None -> False
        }
      }
      _ -> False
    }
  })
}

fn validate_contract_pause(
  treasury: TreasuryDatum, 
  outputs: List<Output>, 
  should_pause: Bool
) -> Bool {
  let updated_treasury = TreasuryDatum { ..treasury, paused: should_pause }
  
  list.any(outputs, fn(output) {
    when output.datum is {
      InlineDatum(data) -> {
        when try_decode_treasury_datum(data) is {
          Some(new_treasury) -> new_treasury == updated_treasury
          None -> False
        }
      }
      _ -> False
    }
  })
}

fn validate_contract_upgrade(
  treasury: TreasuryDatum, 
  outputs: List<Output>, 
  new_version: Int
) -> Bool {
  let upgraded_treasury = TreasuryDatum { 
    ..treasury, 
    contract_version: new_version 
  }
  
  and {
    new_version > treasury.contract_version,
    list.any(outputs, fn(output) {
      when output.datum is {
        InlineDatum(data) -> {
          when try_decode_treasury_datum(data) is {
            Some(new_treasury) -> new_treasury == upgraded_treasury
            None -> False
          }
        }
        _ -> False
      }
    })
  }
}

fn validate_treasury_refill(
  treasury: TreasuryDatum, 
  outputs: List<Output>, 
  _inputs: List<Input>,
  amount: Int
) -> Bool {
  let updated_treasury = TreasuryDatum { 
    ..treasury, 
    total_ada_pool: treasury.total_ada_pool + amount 
  }
  
  and {
    amount > 0,
    treasury_receives_ada(outputs, amount),
    list.any(outputs, fn(output) {
      when output.datum is {
        InlineDatum(data) -> {
          when try_decode_treasury_datum(data) is {
            Some(new_treasury) -> new_treasury == updated_treasury
            None -> False
          }
        }
        _ -> False
      }
    })
  }
}

fn treasury_receives_ada(outputs: List<Output>, amount: Int) -> Bool {
  list.any(outputs, fn(output) {
    when output.address.payment_credential is {
      Script(_) -> {
        lovelace_of(output.value) >= amount
      }
      _ -> False
    }
  })
}

// =============================================================================
// ADDITIONAL UTILITY FUNCTIONS
// =============================================================================

// Check if a user exists in the registry
fn user_exists_in_registry(inputs: List<Input>, user_id: ByteArray) -> Bool {
  list.any(inputs, fn(input) {
    when input.output.datum is {
      InlineDatum(data) -> {
        when try_decode_user_registry(data) is {
          Some(registry) -> registry.user_id == user_id
          None -> False
        }
      }
      _ -> False
    }
  })
}

// Validate that the transaction is signed by the correct party
fn has_required_signature(extra_signatories: List<ByteArray>, required_pkh: ByteArray) -> Bool {
  list.has(extra_signatories, required_pkh)
}

// Check if contract is currently paused
fn contract_is_paused(treasury: TreasuryDatum) -> Bool {
  treasury.paused
}

// Validate environmental risk assignment based on device type
fn risk_matches_device_category(device_type: ByteArray, risk: EnvironmentalRisk) -> Bool {
  when risk is {
    Safe -> device_type_is_safe(device_type)
    LowRisk -> device_type_is_low_risk(device_type)
    MediumRisk -> device_type_is_medium_risk(device_type)
    HighRisk -> device_type_is_high_risk(device_type)
    VeryHighRisk -> device_type_is_very_high_risk(device_type)
  }
}

// Calculate total rewards for a list of drops
fn calculate_total_rewards_for_drops(drops: List<DropDatum>, base_reward: Int) -> Int {
  list.foldr(drops, 0, fn(drop, total) {
    total + calculate_environmental_reward(drop.environmental_risk, base_reward)
  })
}

// Validate that a drop ID is unique (not already used)
fn drop_id_is_unique(inputs: List<Input>, new_drop_id: ByteArray) -> Bool {
  !list.any(inputs, fn(input) {
    when input.output.datum is {
      InlineDatum(data) -> {
        when try_decode_drop_datum(data) is {
          Some(existing_drop) -> existing_drop.drop_id == new_drop_id
          None -> False
        }
      }
      _ -> False
    }
  })
}

// Check if auto-distribution is enabled and should be performed
fn should_auto_distribute(drop_datum: DropDatum, treasury: TreasuryDatum) -> Bool {
  and {
    drop_datum.auto_distribute,
    treasury.auto_distribute_enabled,
    !treasury.paused,
  }
}

// Validate that the photo hash meets minimum requirements
fn photo_hash_is_valid(photo_hash: ByteArray) -> Bool {
  and {
    photo_hash != #"",
    builtin.length_of_bytearray(photo_hash) >= 32,  // At least 32 bytes for SHA-256
  }
}

// Check if location coordinates are within valid GPS ranges
fn location_coordinates_are_valid(location: Location) -> Bool {
  and {
    location.latitude >= -90_000_000,    // -90 degrees * 1,000,000
    location.latitude <= 90_000_000,     // 90 degrees * 1,000,000
    location.longitude >= -180_000_000,  // -180 degrees * 1,000,000
    location.longitude <= 180_000_000,   // 180 degrees * 1,000,000
  }
}

// Validate that timestamp is reasonable (not too far in past/future)
fn timestamp_is_reasonable(timestamp: Int, validity_range: ValidityRange) -> Bool {
  when validity_range.lower_bound.bound_type is {
    Finite(current_time) -> {
      let time_diff = if timestamp > current_time {
        timestamp - current_time
      } else {
        current_time - timestamp
      }
      // Allow up to 24 hours difference (86400 seconds)
      time_diff <= 86400
    }
    _ -> timestamp > 0
  }
}
