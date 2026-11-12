// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/// Player `Account`s: the shared object a player is identified by, with their
/// rating and score. Everything the player has is sent to the `Account` and taken
/// with `Receiving` when needed: recruits, the armory's weapons and armor, the
/// stock of weapon upgrades, and the dog tags of the fallen. The `Registry` maps owner
/// addresses to account IDs; `new_account` aborts if the sender already has an
/// entry. Account mutations call `authorize` to compare the transaction sender
/// with the stored owner.
///
/// A `Recruit` is only ever reached through here. `borrow_recruit` takes them out
/// with a `Borrow` that cannot be dropped, stored or destroyed in any other way
/// than by `return_recruit`, which sends the recruit back to their leader - the
/// `Account` - so a transaction that borrows a recruit ends with them home, however
/// many changes they went through. Out of the `Account`, a recruit is only in a
/// game, which lets go of them by their death. Gear is the player's to do with as
/// they like once requisitioned, out of the armory or off a recruit, and upgrades
/// fit with the functions of `ghosts::weapon`; the armory and the stock are
/// whatever is sent back to the `Account`.
module ghosts::account;

use ghosts::{
    armor::Armor,
    items,
    recruit::{Self, DogTag, Recruit},
    visuals,
    weapon::Weapon,
    weapon_upgrade::WeaponUpgrade
};
use glicko::glicko::{Self, Rating};
use name_gen::name_gen;
use sui::{random::Random, table::{Self, Table}, transfer::Receiving};

/// Trying to create an `Account` when the sender already has one.
const EAccountExists: u64 = 0;
/// Trying to modify an `Account` not owned by the sender.
const ENotOwner: u64 = 1;
/// Trying to hire a free `Recruit` while the squad is already full.
const ERecruitLimitReached: u64 = 2;
/// Invalid voice configuration passed to the recruit editor.
const EInvalidVoice: u64 = 3;
/// Trying to hire while the squad is in a game.
const EInGame: u64 = 6;
/// Returning a `Recruit` for another one's `Borrow`.
const EWrongRecruit: u64 = 7;

/// The `Recruit`'s rank is below what the gear asks for.
const ERankTooLow: u64 = 8;

/// The squad an `Account` can always hold for free, so that nobody is ever out of
/// the game for having lost one.
const FREE_RECRUITS: u64 = 3;
/// How many `Recruit`s an `Account` can hold, hired one at a time past the free squad.
const MAX_RECRUITS: u64 = 8;
/// Number of visual presets per gender in the `Registry`.
const PRESETS_PER_GENDER: u64 = 16;
/// Independent preset draws per recruit: identity (head and eyes), face, body
/// and outfit.
const PRESET_DRAWS: u64 = 4;
/// Number of available voice configurations. The current interface uses
/// `0` (male) and `1` (female); the rest are reserved.
const NUM_VOICES: u8 = 4;

/// Shared registry of all `Account`s. Maps the owner's wallet address to the
/// ID of their `Account`: a single lookup both resolves an address to its
/// account and enforces the one-account-per-address rule.
public struct Registry has key {
    id: UID,
    accounts: Table<address, ID>,
    /// Visual presets hires are mixed from: each entry is the packed area
    /// values `[head, face, eyes, body, outfit]` (see `ghosts::visuals`). The
    /// first `PRESETS_PER_GENDER` entries are male presets, the next ones
    /// female.
    visual_presets: vector<vector<u256>>,
}

/// A player, shared. Their recruits, gear and dog tags are owned by it: sent to
/// its ID, and taken with `Receiving`. Mutation functions compare the
/// transaction sender with `owner`.
public struct Account has key {
    id: UID,
    /// The address which created - and controls - the `Account`.
    owner: address,
    /// Where the player stands: free, searching, in a game or suspended. Anything
    /// but `Idle`, or a `Suspended` past its time, blocks another search.
    state: State,
    /// How many `Recruit`s are at home: hired or back from a game, and neither
    /// dismissed nor out in one.
    recruits: u64,
    /// Glicko rating the player is matched by in `ghosts::find_game`.
    rating: Rating,
    /// How the player's games ended.
    score: Score,
}

/// A `Recruit` taken out of their `Account` by `borrow_recruit`. Only
/// `return_recruit` settles it, by sending the recruit back to their leader, so it
/// can't outlive the transaction without them home.
public struct Borrow {
    object: ID,
}

/// How a player's games ended; their sum is the number of games played.
public struct Score has copy, drop, store {
    wins: u64,
    losses: u64,
    draws: u64,
}

/// Where an `Account` stands; this is all there is to poll. A search a match found
/// stays `Searching` until the `ghosts::Seat` sent to the `Account` is accepted,
/// which makes it `Playing`.
public enum State has copy, drop, store {
    /// Free to search for a game.
    Idle,
    /// An order went into the queue at `since_ms`.
    Searching { order: ID, since_ms: u64 },
    /// In the game with this ID.
    Playing(ID),
    /// Kept from searching until `until_ms` for misbehaving in a game; free to
    /// search again past it.
    Suspended { until_ms: u64 },
}

// === Account Creation ===

/// Create an `Account` for the sender and share it. One per address, enforced
/// by the `Registry`.
public fun new_account(registry: &mut Registry, ctx: &mut TxContext) {
    let owner = ctx.sender();
    assert!(!registry.accounts.contains(owner), EAccountExists);

    let account = Account {
        id: object::new(ctx),
        owner,
        state: State::Idle,
        recruits: 0,
        rating: glicko::default(),
        score: Score { wins: 0, losses: 0, draws: 0 },
    };

    registry.accounts.add(owner, account.id.to_inner());
    transfer::share_object(account);
}

// === Recruits ===

/// Hire the free squad: tops the `Account` up to `FREE_RECRUITS` recruits
/// with random names, looks and voices. Covers the initial set and
/// replacements for the fallen - hiring is free while the squad is not full.
entry fun hire_recruits(acc: &mut Account, registry: &Registry, rng: &Random, ctx: &mut TxContext) {
    acc.authorize(ctx);
    assert!(acc.playing().is_none(), EInGame);
    assert!(acc.recruits < FREE_RECRUITS, ERecruitLimitReached);

    let count = FREE_RECRUITS - acc.recruits;
    acc.hire(registry, rng, count, ctx);
}

/// Hire one more `Recruit` past the free squad, up to `MAX_RECRUITS`.
entry fun hire_recruit(acc: &mut Account, registry: &Registry, rng: &Random, ctx: &mut TxContext) {
    acc.authorize(ctx);
    assert!(acc.playing().is_none(), EInGame);
    assert!(acc.recruits < MAX_RECRUITS, ERecruitLimitReached);

    acc.hire(registry, rng, 1, ctx);
}

/// Hire `count` recruits with random names, looks and voices.
fun hire(acc: &mut Account, registry: &Registry, rng: &Random, count: u64, ctx: &mut TxContext) {
    let mut rng = rng.new_generator(ctx);
    // Presets are drawn without replacement within a batch: one pool of
    // indices per gender and per draw (identity, face, body, outfit), so no
    // two recruits hired together share any part of their look.
    let mut pools = vector::tabulate!(2 * PRESET_DRAWS, |i| {
        let offset = if (i < PRESET_DRAWS) 0 else PRESETS_PER_GENDER;
        vector::tabulate!(PRESETS_PER_GENDER, |j| offset + j)
    });

    count.do!(|_| {
        // flip a coin for the gender: it picks the name, the voice and the half
        // of the presets the look is mixed from
        let is_female = rng.generate_bool();
        let name = if (is_female) name_gen::new_female_name(&mut rng)
        else name_gen::new_male_name(&mut rng);
        let first = if (is_female) PRESET_DRAWS else 0;
        let draws = vector::tabulate!(PRESET_DRAWS, |i| {
            let pool = &mut pools[first + i];
            let j = rng.generate_u64_in_range(0, pool.length() - 1);
            pool.swap_remove(j)
        });

        // head and eyes come from one preset, so hair and brows stay a pair;
        // face, body and outfit are each drawn from another preset of the gender
        let presets = &registry.visual_presets;
        let identity = &presets[draws[0]];
        let visuals = visuals::new_unchecked(
            identity[0],
            presets[draws[1]][1],
            identity[2],
            presets[draws[2]][3],
            presets[draws[3]][4],
        );

        let mut recruit = recruit::new(name, ctx);
        recruit.set_visuals(visuals);
        recruit.set_voice(if (is_female) 1 else 0);
        acc.add_recruit(recruit);
    });
}

/// Take a `Recruit` out of the `Account` to change them: their looks with
/// `edit_recruit`, their gear with `equip_*` and `unequip_*`. The `Borrow` only
/// `return_recruit` settles, in the same transaction.
public fun borrow_recruit(
    acc: &mut Account,
    recruit: Receiving<Recruit>,
    ctx: &mut TxContext,
): (Recruit, Borrow) {
    acc.authorize(ctx);
    let recruit = transfer::public_receive(&mut acc.id, recruit);
    let borrow = Borrow { object: object::id(&recruit) };
    (recruit, borrow)
}

/// Send a `Recruit` taken by `borrow_recruit` back to their leader, the `Account`
/// they came from.
public fun return_recruit(recruit: Recruit, borrow: Borrow) {
    let Borrow { object } = borrow;
    assert!(object == object::id(&recruit), EWrongRecruit);
    let leader = recruit.leader();
    transfer::public_transfer(recruit, leader);
}

/// Edit a borrowed `Recruit`: visual properties (packed by area, up to 32 `u8`
/// values each) and voice configuration. The name is fixed once the Recruit
/// is hired and cannot be changed.
public fun edit_recruit(
    recruit: &mut Recruit,
    head: vector<u8>,
    face: vector<u8>,
    eyes: vector<u8>,
    body: vector<u8>,
    outfit: vector<u8>,
    voice: u8,
) {
    assert!(voice < NUM_VOICES, EInvalidVoice);
    recruit.set_visuals(visuals::new(head, face, eyes, body, outfit));
    recruit.set_voice(voice);
}

/// Dismiss a `Recruit` for good: their weapon and armor go back to the armory,
/// and the freed slot can be filled by `hire_recruits`.
public fun dismiss_recruit(acc: &mut Account, recruit: Receiving<Recruit>, ctx: &mut TxContext) {
    acc.authorize(ctx);
    let (weapon, armor) = transfer::public_receive(&mut acc.id, recruit).dismiss();
    let home = acc.id.to_address();
    weapon.do!(|w| transfer::public_transfer(w, home));
    armor.do!(|a| transfer::public_transfer(a, home));
    acc.recruits = acc.recruits - 1;
}

/// Send a `Recruit` home to the `Account`, which becomes their leader: dog tags
/// and other spoils are sent to it.
public(package) fun add_recruit(acc: &mut Account, mut recruit: Recruit) {
    recruit.set_leader(acc.id.to_address());
    transfer::public_transfer(recruit, acc.id.to_address());
    acc.recruits = acc.recruits + 1;
}

/// Take a `Recruit` out of the `Account` for a game, after checking the sender is
/// the owner.
public(package) fun remove_recruit(
    acc: &mut Account,
    recruit: Receiving<Recruit>,
    ctx: &mut TxContext,
): Recruit {
    acc.authorize(ctx);
    acc.recruits = acc.recruits - 1;
    transfer::public_receive(&mut acc.id, recruit)
}

// === Requisition ===

/// Requisition a rifle of the given tier: for a recruit, or the armory.
public fun requisition_rifle(acc: &Account, tier: u8, ctx: &mut TxContext): Weapon {
    acc.authorize(ctx);
    items::rifle(tier, ctx)
}

/// Requisition armor of the given tier: for a recruit, or the armory.
public fun requisition_armor(acc: &Account, tier: u8, ctx: &mut TxContext): Armor {
    acc.authorize(ctx);
    items::armor(tier, ctx)
}

/// Requisition a weapon upgrade of the given kind and tier: for a weapon, or the
/// stock.
public fun requisition_upgrade(
    acc: &Account,
    kind: u8,
    tier: u8,
    ctx: &mut TxContext,
): WeaponUpgrade {
    acc.authorize(ctx);
    items::upgrade(kind, tier, ctx)
}

// === Gear: Weapons, Armor, Upgrades ===

/// Take a `Weapon` out of the armory.
public fun take_weapon(acc: &mut Account, weapon: Receiving<Weapon>, ctx: &mut TxContext): Weapon {
    acc.authorize(ctx);
    transfer::public_receive(&mut acc.id, weapon)
}

/// Take an `Armor` out of the armory.
public fun take_armor(acc: &mut Account, armor: Receiving<Armor>, ctx: &mut TxContext): Armor {
    acc.authorize(ctx);
    transfer::public_receive(&mut acc.id, armor)
}

/// Arm a borrowed `Recruit` with a `Weapon` their rank allows: from the armory, or
/// off another recruit. The one they carried goes to the armory.
public fun equip_weapon(recruit: &mut Recruit, weapon: Weapon) {
    assert!(recruit.rank().at_least(weapon.required_rank()), ERankTooLow);
    if (recruit.weapon().is_some()) {
        transfer::public_transfer(recruit.remove_weapon(), recruit.leader());
    };
    recruit.add_weapon(weapon);
}

/// Take the `Weapon` off a borrowed `Recruit`: for the armory, or another recruit.
public fun unequip_weapon(recruit: &mut Recruit): Weapon { recruit.remove_weapon() }

/// Fit a borrowed `Recruit` with an `Armor` their rank allows: from the armory, or
/// off another recruit. The one they wore goes to the armory.
public fun equip_armor(recruit: &mut Recruit, armor: Armor) {
    assert!(recruit.rank().at_least(armor.required_rank()), ERankTooLow);
    if (recruit.armor().is_some()) {
        transfer::public_transfer(recruit.remove_armor(), recruit.leader());
    };
    recruit.add_armor(armor);
}

/// Take the `Armor` off a borrowed `Recruit`: for the armory, or another recruit.
public fun unequip_armor(recruit: &mut Recruit): Armor { recruit.remove_armor() }

/// Take a `WeaponUpgrade` out of the stock: to fit to a weapon with
/// `weapon::add_upgrade`.
public fun take_upgrade(
    acc: &mut Account,
    upgrade: Receiving<WeaponUpgrade>,
    ctx: &mut TxContext,
): WeaponUpgrade {
    acc.authorize(ctx);
    transfer::public_receive(&mut acc.id, upgrade)
}

// === Dog Tags ===

/// Take a `DogTag` off the memorial wall: the tags of the fallen are sent to
/// their `Account`.
public fun take_dog_tag(
    acc: &mut Account,
    dog_tag: Receiving<DogTag>,
    ctx: &mut TxContext,
): DogTag {
    acc.authorize(ctx);
    transfer::public_receive(&mut acc.id, dog_tag)
}

// === Matchmaking ===

/// Record an order left in the queue at `since_ms`.
public(package) fun start_search(acc: &mut Account, order: ID, since_ms: u64) {
    acc.state = State::Searching { order, since_ms };
}

/// Put the player into `game`.
public(package) fun set_playing(acc: &mut Account, game: ID) {
    acc.state = State::Playing(game);
}

/// The `Account`'s `UID`, for taking what was sent to it.
public(package) fun uid_mut(acc: &mut Account): &mut UID { &mut acc.id }

/// Back to `Idle`.
public(package) fun clear_search(acc: &mut Account) {
    acc.state = State::Idle;
}

/// Put a finished game on the player's score, given who won it; none for a draw.
public(package) fun add_result(acc: &mut Account, winner: Option<ID>) {
    if (winner.is_none()) {
        acc.score.draws = acc.score.draws + 1;
    } else if (winner == option::some(acc.id.to_inner())) {
        acc.score.wins = acc.score.wins + 1;
    } else {
        acc.score.losses = acc.score.losses + 1;
    }
}

/// Rate a finished game for both players, given who won it; none for a draw.
public(package) fun rate_game(
    first: &mut Account,
    second: &mut Account,
    winner: Option<ID>,
    now_ms: u64,
) {
    let score = if (winner.is_none()) glicko::draw()
    else if (winner == option::some(first.id.to_inner())) glicko::win()
    else glicko::loss();

    let (rating_first, rating_second) = glicko::compute(
        &first.rating,
        &second.rating,
        score,
        now_ms,
    );
    first.rating = rating_first;
    second.rating = rating_second;
}

/// Keep the player from searching for a game until `until_ms`.
public(package) fun suspend(acc: &mut Account, until_ms: u64) {
    acc.state = State::Suspended { until_ms };
}

// === Authorization ===

/// Abort with `ENotOwner` if the sender differs from the account's owner.
public(package) fun authorize(acc: &Account, ctx: &mut TxContext) {
    assert!(acc.owner == ctx.sender(), ENotOwner);
}

// === Getters ===

/// Get the owner of the `Account`.
public fun owner(acc: &Account): address { acc.owner }

/// Get the player's Glicko rating.
public fun rating(acc: &Account): Rating { acc.rating }

/// Get where the player stands.
public fun state(acc: &Account): State { acc.state }

/// Whether the player is neither searching nor in a game: `Idle`, or `Suspended`.
public fun is_idle(acc: &Account): bool {
    match (&acc.state) {
        State::Idle | State::Suspended { .. } => true,
        _ => false,
    }
}

/// Get the matchmaking order ID, if the player is searching for a game.
public fun search_order(acc: &Account): Option<ID> {
    match (&acc.state) {
        State::Searching { order, .. } => option::some(*order),
        _ => option::none(),
    }
}

/// Get the ID of the game the player is in, if any.
public fun playing(acc: &Account): Option<ID> {
    match (&acc.state) {
        State::Playing(game) => option::some(*game),
        _ => option::none(),
    }
}

/// Get the time until which the player cannot search for a game; none past a
/// suspension, or without one.
public fun suspended_until(acc: &Account): u64 {
    match (&acc.state) {
        State::Suspended { until_ms } => *until_ms,
        _ => 0,
    }
}

/// Whether the player has been searching for longer than `timeout_ms`.
public fun search_timed_out(acc: &Account, now_ms: u64, timeout_ms: u64): bool {
    match (&acc.state) {
        State::Searching { since_ms, .. } => now_ms - *since_ms > timeout_ms,
        _ => false,
    }
}

/// Check whether an address has an `Account`.
public fun has_account(registry: &Registry, addr: address): bool {
    registry.accounts.contains(addr)
}

/// Get the ID of the `Account` owned by an address. Aborts if there is none.
public fun account_of(registry: &Registry, addr: address): ID {
    registry.accounts[addr]
}

/// Number of `Recruit`s at home in the `Account`.
public fun num_recruits(acc: &Account): u64 { acc.recruits }

/// How the player's games ended, as `(wins, losses, draws)`.
public fun score(acc: &Account): (u64, u64, u64) {
    (acc.score.wins, acc.score.losses, acc.score.draws)
}

/// Number of games the player has finished.
public fun games_played(acc: &Account): u64 {
    acc.score.wins + acc.score.losses + acc.score.draws
}

// === Init ===

/// On publish, share the `Registry` with the initial set of visual presets.
fun init(ctx: &mut TxContext) {
    transfer::share_object(Registry {
        id: object::new(ctx),
        accounts: table::new(ctx),
        visual_presets: visual_presets(),
    });
}

/// `init` for the tests: a module's own extensions cannot call it.
#[test_only]
public fun init_for_testing(ctx: &mut TxContext) { init(ctx) }

/// The looks hires are mixed from: 16 male, then 16 female presets, encoded
/// with the appearance codec in `@ghosts/squad` (codec version 1).
fun visual_presets(): vector<vector<u256>> {
    // presets:begin - generated by `pnpm --dir app build:visual-presets`
    vector[
        vector[
            0xa6282a260000990000202835038000007c66cb9080ffffff03b30301,
            0x8080808080674d80ac808080c63a80a68080b38080ac80b380a0806d938099,
            0x8080808060ff80808080263342048080808080808080805a808080ac5a05,
            0x8e6084be7a6a00,
            0x4844342c2b270093903c59595243413c,
        ],
        vector[
            0xa6282a2600009900001e1e20018000007c66cb9080ffffff028c0201,
            0x8080808080b9c080ac8080c080a66080b98da080808080938080ac998080a6,
            0x8080808080ff80808080263342008080808080808080808f80808080b300,
            0x9b8e9ebe7fa700,
            0x4844342c2b27003d71be3d3a359aa8ab,
        ],
        vector[
            0xa6282a260000990000445263028000007c66cb9080ffffff03730701,
            0x8080808080605a7167806080c05aa6c08080808080a0ac80a093805a80ac67,
            0x8080808080ff808080802633420880808080808080808067808080a08004,
            0x7c776dbe5a7500,
            0x4844342c2b270073a0b4302c27373463,
        ],
        vector[
            0x6c282a2603038a0300649cbd008e0100546dbb5e60cae5ee019c0201,
            0x73807478984838594969ab954f5f6d316783915b63897d97a85886929fa9a0,
            0x756c5a796dfe52d069d2446380024cac65919ba05c6e8eb67a8698a8bb02,
            0x848a7398837a00,
            0x48443434465c0061a0b92a2e29425d55,
        ],
        vector[
            0xb9423b39020471000026354901500030708cd59c95dce7f700900401,
            0x8b536679826c7250474f7055c652bfb2605c6d9da5838a6b918659534dab5c,
            0x9aac6f7ca2c3c55f5a76263549008b936e6fa18e7f967ba06b765ea96301,
            0x685f83a2a78b00,
            0x4844342c2b270093903c59595243413c,
        ],
        vector[
            0x7d282a260001ac0204446078007501507c66cbbaa5ffffff02830101,
            0x87617c6d6ec2ada345605263af3f9fb5516c87787a7b898f659b50566d5e72,
            0x6f79a9877f7f53ad737444607804625d8c9c73976994825a9962976bb205,
            0x8b847188918d00,
            0x734844342c2b27043d71be3d3a359aa8ab,
        ],
        vector[
            0x6e363d500008730000202a4d00580000546dbbb370cae5ee008f0701,
            0x8e6b7f9296808d5aae9e8aba727f9470a9847267a07a8346938c8d8a658646,
            0x8fa09b8067c640b47b96202a4d0b6077c175966f967c5e6fa09a9aa75502,
            0x7a917b9d649400,
            0x4844347b96a50073a0b4302c27373463,
        ],
        vector[
            0xac363d5003066a030044607803a90142694ea7ba8cdce7f701860601,
            0x6c778aaf8d7ca060b75482567d4b7b8f6a6da8848cc38ba997835c5b69ada5,
            0x728b5a926d7e749475b34460780071a390ae5a77a9909463a38a6d626600,
            0x675a67a1676a00,
            0x4844342c2b270061a0b92a2e29425d55,
        ],
        vector[
            0x92423b390200a800007980860173012a694ea77c63ffffff045a0201,
            0x8672a0a0645b55aa9e646a5fc93baaaf53a5568a618f64865c8f85a76850b7,
            0x82aa757a7ccfa430977f798086076d726793829e6dbc705a8ba197b15304,
            0x725e6eb97c9b00,
            0x4844342c2b270093903c59595243413c,
        ],
        vector[
            0xb7423b39020061000044607803ab004b694ea7738cdddfe502740501,
            0x8fa4a67793573a716d9e93b152985255c9745c81a081908c9d93796f7f5489,
            0x8ea96b7e88d6b4d02ead446078047b8ec5755e756d6d5f635c9da2847d05,
            0x8367718f607800,
            0x4844342c2b27003d71be3d3a359aa8ab,
        ],
        vector[
            0x77423b390100a501001c1e2100750100694ea7ba80ffffff04830201,
            0xa47e648e85794a66a2665e58b42eb0b83d6b9170a593ac749c86606d6bbc77,
            0x818e987062c76252c1921c1e210299a668559892997299b177a380a8ae01,
            0x969698c0785400,
            0x4844347b96a50073a0b4302c27373463,
        ],
        vector[
            0xaf423b3902017a0200798086028c00007c66cb935edce7f7005f0301,
            0x67946d9d80717d8d9863b67f5450745466665a825f716c6593837b72ab485d,
            0x8386836f7794a6575d8c798086068298b1678269a576445f73a389594e07,
            0x84916da6887b00,
            0x4844347b96a50061a0b92a2e29425d55,
        ],
        vector[
            0x6a423b3902009203001c1e2100580128694ea7bd83cae5ee045c0601,
            0x9b79aa976fa394aa946a7a5286569a92537a6575a37f8451a5905f5250be61,
            0x7ea27ca47b7f4932b6451c1e210a7e90636d718b6a728460aca497985502,
            0x886a8a91789200,
            0x4844342c2b270093903c59595243413c,
        ],
        vector[
            0x7d282a260200af0100202a4d03960100694ea77192bfd3ea00a50701,
            0x88849f76655242a98c8f46a1b491cca1967977807b86946f5d7f8a83858789,
            0x9194847e53ab6a5db66b202a4d0b775b5d6e9da97ad3525f96679f74a805,
            0x9e647c83757100,
            0x4844347b96a5003d71be3d3a359aa8ab,
        ],
        vector[
            0xb5423b390200a30300649cbd0066013a546dbbbb62ffffff02860101,
            0x83a4908f836961abbb648a508e4d8a785da25f83816a9a8c7b66a4b8a5a55f,
            0x6778706c6ac4834f605644638008819e64649a8b76768b9f7e7978776002,
            0x8699809d847800,
            0x734844347b96a50473a0b4302c27373463,
        ],
        vector[
            0x8c282a2602008b030026356e014d00437c66cb685ddce7f701950401,
            0x7cb16d586758457ba2a69ac26aa15673bc5da18b839e5d7c8aa2745b714296,
            0x688e8aaa99767a65498926356e037085b3815c7ea68860576a8c93828f07,
            0x8a78a683898800,
            0x4844342c2b270061a0b92a2e29425d55,
        ],
        vector[
            0xa6282a260000990000202835058000007c66cb9080ffffff00a60101,
            0x8080808080a0ac808080a6675480804d80805a80808067548080a49c806780,
            0x8080808080ff80808080263342018080808080808080808d80808080a602,
            0x6869848b897a01,
            0x4844342c2b270093903c59595243413c,
        ],
        vector[
            0xa6282a260000990000202835068000007c66cb9080ffffff02a60201,
            0x8080808080c6d380998080c080c05a80ac8080808080809d8080a0998069a9,
            0x8080808067ff80808080263342048080808080808080808080808099b900,
            0x9c5e9e9b84aa01,
            0x4844342c2b27003d71be3d3a359aa8ab,
        ],
        vector[
            0xa6282a260000990000201b19058000007c66cb9080ffffff01800501,
            0x80808080808073805a80809380805a6080806080806d804d8080808067808d,
            0x8080808080ff808080802633420880808080808080d9804db38080808d01,
            0x947f67a65f5701,
            0x4844342c2b270073a0b4302c27373463,
        ],
        vector[
            0x7a363d5003016c02001c1e21058201007c66cb61a0dddfe504740401,
            0x8d8b75798777718dbb6d8850833a979d56697783737b8a9880985d4e526da5,
            0x7b9fa161729e407c807d1c1e2101ae6abe6577556c635970856e816c7c07,
            0x7b8fa5c0987101,
            0x48443434465c0061a0b92a2e29425d55,
        ],
        vector[
            0x9e363d500000870000a7b4b805960100546dbba972bfd3ea006c0701,
            0x795c7e7b7e4c379f4d79428cb7a8c4aa978d51889f86789377688c9f729a7e,
            0x7b93768947a55c32814c565e630aa477ca6e7c858f85507c8397998b8b02,
            0x678680b56e5a01,
            0x4844342c2b270093903c59595243413c,
        ],
        vector[
            0x9e282a260000ae0300649cbd064d00007c66cb8c5bdddfe502920201,
            0x9f75a69b858ea45781678b3e76419a924e889b74a29c79556d7e767dac6a5c,
            0x6268938582e0568ac88c44638003604c6c649ba18cbb92a78d7e85584805,
            0x8a946db37cae01,
            0x4844347b96a5003d71be3d3a359aa8ab,
        ],
        vector[
            0xb4282a2602008f0201a7b4b804b20130708cd59e7dffffff03540301,
            0xa49463866c8377b182a192bc777da56cb26654879b6d65757c9962647255a3,
            0x75a5a07d638d9f71464c565e63078774c770957587745c769369a57d7606,
            0x8e946786968301,
            0x4844347b96a50073a0b4302c27373463,
        ],
        vector[
            0xaf282a260107a3020126356e04bf0132708cd5855abfd3ea02590201,
            0x5f93987276aec6744b5082478d539386575a6c83666b724479a5505480414e,
            0x89637296a8f45c307b9926356e036c876d818c5f8c7791668a959ca2a901,
            0x7f83768b5c7201,
            0x48443434465c0161a0b92a2e29425d55,
        ],
        vector[
            0xba282a2602006c01041c1e2105670024694ea78b86dce7f7015a0301,
            0x8382848856c5c36f715e84557d538693538e738fa0a3a48f756196ae7097ba,
            0x6b88799165acaf68c0501c1e2108ba87887ca57b89cb6ca5689d6659c402,
            0x7a7b9ea6677d01,
            0x48443434465c0093903c59595243413c,
        ],
        vector[
            0x8e363d50010077010079808605a9013a546dbb5c78bfd3ea05840601,
            0x9a7f8b75845757697662b87a524b663a64554e895c71a59e76a757505bafb0,
            0x686b7da156e366b26ca3798086039757bc7b6f8f9f854e5a7e686f727607,
            0x7f9784aeb26c01,
            0x4844342c2b27003d71be3d3a359aa8ab,
        ],
        vector[
            0x8d423b390200a10003649cbd048c0100694ea74b7dcae5ee03940701,
            0x60ae7f99643f416d70865696aa9fc8c09ba15682a05485807a8ea6b850568f,
            0x8d53a69f93b9b2417fa844638004618d7e87816685bf646da69d80605701,
            0x6e996ab86e7f01,
            0x48443434465c0073a0b4302c27373463,
        ],
        vector[
            0x87363d5002038700002635490476004c546dbb4d9adce7f7019c0301,
            0x63728a7682656e90c44d5b53c547b1b13ea3b28da0827aac7a549bbf5b77bb,
            0x9480669990a94a9a79af263549098e917f7c6b9171ba5b52a38478978104,
            0x818e728b8faf01,
            0x4844347b96a50061a0b92a2e29425d55,
        ],
        vector[
            0xbc423b390206ac0004202a4d069f002c694ea7899fcae5ee035a0601,
            0x8e7b7486657277527d69aa825a546b576b756e814e9f6d8c79936c52998872,
            0x979156ae88e2b4797087202a4d088e84c57b9f7381a061643f6c6a63ae07,
            0x6a6599be8bb001,
            0x48443434465c0293903c59595243413c,
        ],
        vector[
            0x78282a2602007a00034460780667012c7c66cb7b5cffffff02700101,
            0xa9a46d798ea9b68675b08ec873629682bb88848dbf777a708e7fa6bf76b969,
            0x736f5965888c79645da34460780a498c925b758565908e569a81748a4e04,
            0x897c868e9e6d01,
            0x4844347b96a5003d71be3d3a359aa8ab,
        ],
        vector[
            0x97282a2602057e0200202a4d04680047694ea79491dddfe5017e0401,
            0x7975867c9a6f606271585357d148a7af447ea890b78380479363819a9db558,
            0x85759f9f52ed708bada5202a4d057b7ca29d797779d3625d94697d7ebf06,
            0x6788a596aea501,
            0x48443434465c0073a0b4302c27373463,
        ],
        vector[
            0x7e282a260300830200a7b4b805720100708cd58063ffffff03740301,
            0x8e7c7ca29c506d78b09b94bb7382926aaeb3805ba08b736b8461a9bab0944e,
            0x787c975f50de5d8d7b65565e63078074799870599bca8a639d75979b8407,
            0x676780918e7701,
            0x48443434465c0061a0b92a2e29425d55,
        ],
    ]
    // presets:end
}
