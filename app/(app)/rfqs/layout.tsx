import RfqsNav from './RfqsNav';

export default function RfqsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <h1 className="text-[26px] font-bold mb-1">RFQs</h1>
      <p className="text-[13.5px] mb-5" style={{ color: 'var(--faint)' }}>
        Requirements in, a confirmed order and delivery out.
      </p>
      <RfqsNav />
      {children}
    </>
  );
}
