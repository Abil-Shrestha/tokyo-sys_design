interface cardProps {
  cn: String;
  text: String;
}
const Card = ({ cn, text }: cardProps) => {
  return (
    <div
      className={`card ${cn}`}
    >
      {text}
    </div>
  );
};

export default Card;
