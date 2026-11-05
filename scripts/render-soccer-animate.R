# Render FM world's synthesized tracking data with the original soccerAnimate package.
# This is an API adapter, not a translation/copy of its GPL implementation.
# Prerequisite (run separately): remotes::install_github("Dato-Futbol/soccerAnimate")
# Usage: Rscript scripts/render-soccer-animate.R artifacts/match-tracking.csv artifacts/match base
# Last argument: base | convexhull | voronoi | delaunay
args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 2) stop("Usage: Rscript scripts/render-soccer-animate.R <tracking.csv> <output-without-extension> [base|convexhull|voronoi|delaunay]")
if (!requireNamespace("soccerAnimate", quietly = TRUE)) stop("Install R and soccerAnimate first: remotes::install_github('Dato-Futbol/soccerAnimate')")
method <- if (length(args) >= 3) args[[3]] else "base"
if (!(method %in% c("base", "convexhull", "voronoi", "delaunay"))) stop("Unknown visualization method")
td <- read.csv(args[[1]], stringsAsFactors = FALSE, check.names = FALSE)
required <- c("period", "frame", "time", "second", "player", "x", "y", "team", "is_gk", "dx", "dy")
if (!all(required %in% names(td)) || nrow(td) == 0) stop("Not a valid FM world tracking CSV")
# Rows are already tidy, in meters and with Y converted to plotting coordinates.
# Do not call get_tidy_data(): it would flip/re-scale these coordinates a second time.
output <- args[[2]]
dir.create(dirname(output), recursive = TRUE, showWarnings = FALSE)
soccerAnimate::soccer_animate(
  tidy_data = td, ini_time = min(td$second), end_time = max(td$second), method = method,
  pitch_long = 105, pitch_width = 68, provider = "Metrica",
  pitch_fill = "#235432", pitch_lines_col = "#eeeeee",
  home_team_col = "#50b8ef", away_team_col = "#ee6666",
  title = "FM world - reconstructed match", subtitle = "Synthesized tracking, 25 fps",
  show_anim = FALSE, export_gif = TRUE, gif_name = output
)
