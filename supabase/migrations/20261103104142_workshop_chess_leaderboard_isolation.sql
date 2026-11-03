begin;
-- 保留 Go RPC 的五個參數；新增西洋棋只能透過按時控分榜的接口讀取。
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.get_board_game_leaderboard(text,text,integer,text,integer)'::regprocedure);
 if strpos(definition,'s.game=game_name')=0 then raise exception 'Review the existing board leaderboard before changing its game filter.';end if;
 definition:=replace(definition,'s.game=game_name','s.game=''go'' and game_name=''go'' and s.time_control=''''');
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
