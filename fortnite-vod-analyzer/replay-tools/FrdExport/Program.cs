// Usage: FrdExport <file.replay> [--max-samples-per-player N]
// Writes one JSON document to stdout. Exit codes: 0 ok, 2 bad args, 3 parse error.
using System.Text.Json;
using System.Text.Json.Serialization;
using FortniteReplayReader;
using Unreal.Core.Models.Enums;

if (args.Length < 1 || !File.Exists(args[0]))
{
    Console.Error.WriteLine("usage: FrdExport <file.replay> [--max-samples-per-player N]");
    return 2;
}
var maxSamples = 4000;
for (var i = 1; i < args.Length - 1; i++)
    if (args[i] == "--max-samples-per-player") maxSamples = int.Parse(args[i + 1]);

static double? W(float? f, double? d) => d ?? (f.HasValue ? f.Value : null);

try
{
    var reader = new ReplayReader(null, ParseMode.Full);
    var replay = reader.ReadReplay(args[0]);

    var players = replay.PlayerData?.Select(p => new
    {
        id = p.Id,
        player_id = p.PlayerId,
        epic_id = p.EpicId,
        name = p.PlayerName ?? p.StreamerModeName,
        is_bot = p.IsBot,
        team_index = p.TeamIndex,
        placement = p.Placement,
        kills = p.Kills,
        platform = p.Platform,
        is_replay_owner = p.IsReplayOwner,
        death_time_world = W(p.DeathTime, p.DeathTimeDouble),
        death_cause = p.DeathCause,
        locations = Sample(p.Locations
            .Where(l => l.ReplicatedMovement?.Location != null)
            .Select(l => new
            {
                t_world = W(l.ReplicatedWorldTimeSeconds, l.ReplicatedWorldTimeSecondsDouble),
                x = l.ReplicatedMovement!.Value.Location.X,
                y = l.ReplicatedMovement!.Value.Location.Y,
                z = l.ReplicatedMovement!.Value.Location.Z,
                dbno = l.bIsDBNO,
            }).Where(l => l.t_world.HasValue).ToList(), maxSamples),
    }).ToList();

    var killfeed = replay.KillFeed.Select(k => new
    {
        player_id = k.PlayerId,
        player_name = k.PlayerName,
        finisher_id = k.FinisherOrDowner,
        finisher_name = k.FinisherOrDownerName,
        t_world = W(k.ReplicatedWorldTimeSeconds, k.ReplicatedWorldTimeSecondsDouble),
        distance = k.Distance,
        is_downed = k.IsDowned,
        is_revived = k.IsRevived,
        death_cause = k.DeathCause,
    });

    var zones = replay.MapData.SafeZones.Select(z => new
    {
        radius = z.Radius,
        start_shrink_world = z.StartShrinkTime,
        finish_shrink_world = z.FinishShrinkTime,
        last_x = z.LastCenter?.X, last_y = z.LastCenter?.Y, last_radius = z.LastRadius,
        next_x = z.NextCenter?.X, next_y = z.NextCenter?.Y, next_radius = z.NextRadius,
    });

    var doc = new
    {
        tool = "FrdExport",
        reader_version = typeof(ReplayReader).Assembly.GetName().Version?.ToString(),
        length_ms = replay.Info.LengthInMs,
        branch = replay.Header.Branch,
        game = new
        {
            playlist = replay.GameData.CurrentPlaylist,
            max_players = replay.GameData.MaxPlayers,
            team_size = replay.GameData.TeamSize,
            total_bots = replay.GameData.TotalBots,
            recorder_id = replay.GameData.RecorderId,
            aircraft_start_world = replay.GameData.AircraftStartTime,
            safe_zones_start_world = replay.GameData.SafeZonesStartTime,
            match_end_world = replay.GameData.MatchEndTime,
            winning_player_ids = replay.GameData.WinningPlayerIds,
        },
        eliminations = replay.Eliminations.Select(e => new
        {
            time_ms = (long)e.Info.StartTime,
            eliminated = e.EliminatedInfo.Id,
            eliminator = e.EliminatorInfo.Id,
            knocked = e.Knocked,
        }),
        players,
        killfeed,
        safe_zones = zones,
    };
    var opts = new JsonSerializerOptions { DefaultIgnoreCondition = JsonIgnoreCondition.Never };
    Console.Out.Write(JsonSerializer.Serialize(doc, opts));
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine(JsonSerializer.Serialize(new { error = ex.GetType().Name, message = ex.Message }));
    return 3;
}

static List<T> Sample<T>(List<T> items, int max)
{
    if (items.Count <= max) return items;
    var step = (double)items.Count / max;
    var outList = new List<T>(max);
    for (var i = 0; i < max; i++) outList.Add(items[(int)(i * step)]);
    return outList;
}
