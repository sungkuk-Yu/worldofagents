-- Atomic room name/member edits; existing state tables remain the source of truth.
CREATE OR REPLACE FUNCTION update_group_room(
  p_room_id UUID,
  p_owner_id UUID,
  p_name TEXT,
  p_members JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_room group_rooms%ROWTYPE;
  v_members JSONB;
BEGIN
  IF p_owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'group room not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_room FROM group_rooms
   WHERE id = p_room_id AND owner_id = p_owner_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'group room not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_name IS NOT NULL THEN
    UPDATE group_rooms SET name = p_name, updated_at = now()
     WHERE id = p_room_id RETURNING * INTO v_room;
  END IF;

  IF p_members IS NOT NULL THEN
    DELETE FROM group_room_members WHERE room_id = p_room_id;
    INSERT INTO group_room_members (room_id, member_type, member_id)
    SELECT p_room_id, x.member_type, x.member_id
      FROM jsonb_to_recordset(p_members) AS x(member_type TEXT, member_id UUID);
    SELECT COALESCE(jsonb_agg(to_jsonb(m)), '[]'::jsonb) INTO v_members
      FROM group_room_members m WHERE m.room_id = p_room_id;
  ELSE
    v_members := NULL;
  END IF;

  RETURN jsonb_build_object('room', to_jsonb(v_room), 'members', v_members);
END;
$$;

REVOKE ALL ON FUNCTION update_group_room(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION update_group_room(UUID, UUID, TEXT, JSONB) TO authenticated, service_role;