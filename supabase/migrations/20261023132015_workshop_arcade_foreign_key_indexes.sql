begin;
-- Cover new foreign keys without changing room or milestone behavior.
create index game_achievement_unlock_rule on workshop_private.game_achievement_unlocks(achievement_id);
create index pong_room_host on workshop_private.pong_rooms(host_id);
commit;
