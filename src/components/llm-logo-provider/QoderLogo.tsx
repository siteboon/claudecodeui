import qoderLogo from '../../assets/qoder.png';

type QoderLogoProps = {
  className?: string;
};

const QoderLogo = ({ className = 'w-5 h-5' }: QoderLogoProps) => (
  <img src={qoderLogo} alt="Qoder" className={className} draggable={false} />
);

export default QoderLogo;
