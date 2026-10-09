
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// Tier kayıtları şimdilik RAM'de tutulur.
// Bot yeniden başlatılırsa kayıtlar silinir.
const players = new Map();

const tiers = ["HT1", "LT1", "HT2", "LT2", "HT3", "LT3", "HT4", "LT4", "HT5", "LT5"];

const commands = [
  new SlashCommandBuilder()
    .setName("tierver")
    .setDescription("Bir oyuncuya tier verir.")
    .addUserOption(option =>
      option.setName("oyuncu")
        .setDescription("Tier verilecek oyuncu")
        .setRequired(true))
    .addStringOption(option =>
      option.setName("tier")
        .setDescription("Verilecek tier")
        .setRequired(true)
        .addChoices(...tiers.map(tier => ({
          name: tier,
          value: tier
        }))))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("tierkaldir")
    .setDescription("Oyuncunun tier kaydını kaldırır.")
    .addUserOption(option =>
      option.setName("oyuncu")
        .setDescription("Oyuncu")
        .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("tier")
    .setDescription("Bir oyuncunun tierini gösterir.")
    .addUserOption(option =>
      option.setName("oyuncu")
        .setDescription("Profili görüntülenecek oyuncu")
        .setRequired(false)),

  new SlashCommandBuilder()
    .setName("tierlist")
    .setDescription("Sunucudaki kayıtlı oyuncuların tier listesini gösterir."),

  new SlashCommandBuilder()
    .setName("tierim")
    .setDescription("Kendi tierini gösterir.")
].map(command => command.toJSON());

client.once("ready", async () => {
  console.log(`${client.user.tag} aktif!`);

  if (!TOKEN || !CLIENT_ID) {
    console.error("DISCORD_TOKEN veya CLIENT_ID eksik!");
    process.exit(1);
  }

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );

    console.log("Slash komutları Discord'a kaydedildi.");
  } catch (error) {
    console.error("Komut kayıt hatası:", error);
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guildId } = interaction;

  if (commandName === "tierver") {
    const user = interaction.options.getUser("oyuncu");
    const tier = interaction.options.getString("tier");

    players.set(`${guildId}:${user.id}`, {
      userId: user.id,
      tier,
      updatedBy: interaction.user.id,
      updatedAt: Date.now()
    });

    const embed = new EmbedBuilder()
      .setColor("#8B5CF6")
      .setTitle("🏆 SVEYDY TIER SİSTEMİ")
      .setDescription(`${user} oyuncusuna **${tier}** tieri verildi.`)
      .setFooter({ text: `Yetkili: ${interaction.user.tag}` })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === "tierkaldir") {
    const user = interaction.options.getUser("oyuncu");
    const key = `${guildId}:${user.id}`;

    if (!players.has(key)) {
      return interaction.reply({
        content: "Bu oyuncunun kayıtlı bir tieri yok.",
        ephemeral: true
      });
    }

    players.delete(key);

    return interaction.reply({
      content: `✅ ${user} oyuncusunun tier kaydı kaldırıldı.`,
      ephemeral: true
    });
  }

  if (commandName === "tier" || commandName === "tierim") {
    const user = commandName === "tierim"
      ? interaction.user
      : interaction.options.getUser("oyuncu") || interaction.user;

    const data = players.get(`${guildId}:${user.id}`);

    if (!data) {
      return interaction.reply({
        content: `❌ ${user} için kayıtlı bir tier bulunamadı.`,
        ephemeral: true
      });
    }

    const embed = new EmbedBuilder()
      .setColor("#8B5CF6")
      .setTitle("👤 Oyuncu Tier Profili")
      .setThumbnail(user.displayAvatarURL())
      .addFields(
        { name: "Oyuncu", value: `${user}`, inline: true },
        { name: "Tier", value: `**${data.tier}**`, inline: true }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === "tierlist") {
    const list = [...players.entries()]
      .filter(([key]) => key.startsWith(`${guildId}:`))
      .map(([, data]) => data)
      .sort((a, b) => tiers.indexOf(a.tier) - tiers.indexOf(b.tier));

    if (!list.length) {
      return interaction.reply("Henüz kayıtlı oyuncu yok.");
    }

    const description = list.map((player, index) =>
      `**${index + 1}.** <@${player.userId}> — **${player.tier}**`
    ).join("\n");

    const embed = new EmbedBuilder()
      .setColor("#8B5CF6")
      .setTitle("🏆 SVEYDY TIER LIST")
      .setDescription(description.slice(0, 4000))
      .setFooter({ text: `Toplam kayıt: ${list.length}` });

    return interaction.reply({ embeds: [embed] });
  }
});

client.login(TOKEN);
