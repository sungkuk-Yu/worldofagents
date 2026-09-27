import React from 'react';
import TextCard from './TextCard';
import { MessageAttachments } from '../components/MessageAttachments';
import PhotoEditCard, { buildPhotoEditView, hasPhotoEditFence } from '../components/PhotoEditCard';
import { normalizeAttachments } from '../lib/photoLogic';
import type { CardProps } from './types';
export default function UserCard(props: CardProps) {
  const { message } = props;
  // photo_edit 지시 (t_4497cfce §1): 원본은 첨부로 저장·표시되고 지시는 content 산문+JSON 펜스에 공존.
  // 펜스가 있으면 원문 JSON을 그대로 보여주지 않고 재현 카드(원본+오버레이)로 대체한다.
  const editView = hasPhotoEditFence(message.content) ? buildPhotoEditView(message.content, normalizeAttachments(message.attachments)) : null;
  return <>
    {editView
      ? <PhotoEditCard data={editView} />
      : <TextCard {...props} />}
    {!editView && <MessageAttachments value={message.attachments} drafts={message.pendingAttachments} />}
  </>;
}
