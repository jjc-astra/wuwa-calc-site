// A deleted node shown in place, with Restore and discard.
import React from 'react';
import { useBuilderStore } from '../../store/useBuilderStore';
import { tip, TooltipManager } from '../../utils/Common';
import { CloseIcon } from '../common/icons';
import type { MechanicNode } from '../../types';

interface RemovedNodeRowProps {
  nodeId: string;
  node: MechanicNode;
}

export const RemovedNodeRow: React.FC<RemovedNodeRowProps> = ({ nodeId, node }) => {
  const { restoreRemovedNode, discardRemovedNode } = useBuilderStore();
  // Unmounting skips mouseleave.
  const restore = () => { TooltipManager.hide(); restoreRemovedNode(nodeId); };
  const discard = () => { TooltipManager.hide(); discardRemovedNode(nodeId); };
  return (
    <tbody className="mech-removed-row">
      <tr>
        <td></td>
        <td colSpan={10}>
          <div className="mech-removed-node">
            <span className="mech-removed-name">{node.name || nodeId}</span>
            <span className="mech-removed-label caps-label">Deleted</span>
            <button type="button" className="base-btn text-xs" onClick={restore} {...tip('Put the node back where it was')}>
              Restore
            </button>
          </div>
        </td>
        <td className="mech-col-remove">
          <button
            type="button"
            className="base-btn icon-btn remove-node-btn btn-danger icon-btn-sm"
            onClick={discard}
            {...tip('Discard for good')}
          >
            <CloseIcon size={12} />
          </button>
        </td>
      </tr>
    </tbody>
  );
};
